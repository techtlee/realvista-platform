/**
 * Phase B: backend-<slug> (runbook steps 5–10). Each step's probe looks at
 * the world (git trailers, files, the database, HTTP), never only at state.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { countRows, tenantIdBySlug, userExists } from '../backend/db.js'
import { renderBackendReadme, renderDependabot } from '../backend/templates.js'
import { dbName } from '../dbname.js'
import type { Ctx, PlannedCommand, Probe, SecretRef, Step } from '../types.js'
import { CwError } from '../types.js'
import {
  TEMPLATE_TRAILER,
  backendUrl,
  commitAll,
  fileSha,
  fingerprintOf,
  gitInit,
  hasStepCommit,
  httpStatus,
  isNonEmptyDir,
  nowIso,
  outputs,
  parseKv,
  rootTemplateTrailer,
  siteUrlLocal,
} from './util.js'

const ENV: SecretRef['file'] = 'backend/.env'
const CREDS: SecretRef['file'] = 'backend/.admin-credentials.local'

function cmsCommit(ctx: Ctx): string {
  const c = ctx.state.get().templates.cms?.commit
  if (!c) throw new CwError('PRECONDITION', 'cms template commit is not pinned in state', { hint: 'preflight pins it; run `cw run` again' })
  return c
}

function tmpDir(ctx: Ctx, kind: 'backend' | 'site'): string {
  return join(dirname(ctx.paths.backend), `.cw-tmp-${ctx.state.get().runId}-${kind}`)
}

/** Probe for a template copy: our trailer on the root commit = done; anything else non-empty = TARGET_EXISTS. */
export async function probeTemplateCopy(ctx: Ctx, target: string, expected: string, kind: 'backend' | 'site'): Promise<Probe> {
  if (isNonEmptyDir(target)) {
    const t = await rootTemplateTrailer(ctx, target)
    if (t === expected) return { state: 'done' }
    return {
      state: 'conflict',
      code: 'TARGET_EXISTS',
      detail: t
        ? `${target} was copied from ${t}, not ${expected}`
        : `${target} exists and was not created by /create-website`,
    }
  }
  if (existsSync(tmpDir(ctx, kind))) return { state: 'partial', detail: `half-written temp dir from run ${ctx.state.get().runId}` }
  return { state: 'absent' }
}

/** Remove only this run's temp dirs (never anything else). */
export async function recoverTmp(ctx: Ctx, kind: 'backend' | 'site'): Promise<void> {
  const parent = dirname(ctx.paths.backend)
  const prefix = `.cw-tmp-${ctx.state.get().runId}-${kind}`
  if (!existsSync(parent)) return
  for (const name of readdirSync(parent)) if (name.startsWith(prefix)) rmSync(join(parent, name), { recursive: true, force: true })
}

/** Move a finished temp dir into place. An empty target dir is fine to replace. */
export function moveIntoPlace(tmp: string, target: string): void {
  if (existsSync(target)) {
    if (isNonEmptyDir(target)) throw new CwError('TARGET_EXISTS', `${target} appeared while copying`)
    rmSync(target, { recursive: true, force: true })
  }
  mkdirSync(dirname(target), { recursive: true })
  renameSync(tmp, target)
}

const noPlan = (): PlannedCommand[] => []

// ---------------------------------------------------------------------------

export const backendCopy: Step = {
  id: 'backend-copy',
  runbook: '5',
  phase: 'B',
  crmLogName: 'backend-repo-local',
  outward: false,
  dependsOn: ['record-repo'],
  fingerprint: (ctx) => fingerprintOf({ cms: ctx.state.get().templates.cms?.commit }),
  probe: (ctx) => probeTemplateCopy(ctx, ctx.paths.backend, `cms@${cmsCommit(ctx)}`, 'backend'),
  recover: (ctx) => recoverTmp(ctx, 'backend'),
  async run(ctx) {
    const sha = cmsCommit(ctx)
    // Re-run on a stale fingerprint must never copy over our own repo.
    if ((await probeTemplateCopy(ctx, ctx.paths.backend, `cms@${sha}`, 'backend')).state === 'done') return outputs({ template: `cms@${sha}`, reused: true })
    const tmp = tmpDir(ctx, 'backend')
    mkdirSync(tmp, { recursive: true })
    const tar = `${tmp}.tar`
    // git archive: committed content only, so a dirty cms checkout never leaks in
    await ctx.exec.run(['git', 'archive', '--format=tar', '-o', tar, sha], { cwd: ctx.cfg.cmsRepo })
    await ctx.exec.run(['tar', '-xf', tar, '-C', tmp], { cwd: tmp })
    rmSync(tar, { force: true })
    ctx.testHooks?.mid('backend-copy')
    await gitInit(ctx, tmp)
    const commit = await commitAll(ctx, tmp, `Copy of realvista-client-backend template (cms ${sha.slice(0, 7)})`, {
      step: 'backend-copy',
      body: 'Unmodified template, so every client-specific change is a visible diff on top of it.',
      trailers: { [TEMPLATE_TRAILER]: `cms@${sha}` },
    })
    moveIntoPlace(tmp, ctx.paths.backend)
    return outputs({ commit, template: `cms@${sha}` })
  },
  plan: noPlan,
}

export const backendCustomize: Step = {
  id: 'backend-customize',
  runbook: 'F14',
  phase: 'B',
  crmLogName: 'backend-repo-local',
  outward: false,
  dependsOn: ['backend-copy'],
  fingerprint: (ctx) => fingerprintOf({ slug: ctx.request.slug, brand: ctx.request.provisioning.brand.name }),
  probe: async (ctx) => ((await hasStepCommit(ctx, ctx.paths.backend, 'backend-customize')) ? { state: 'done' } : { state: 'absent' }),
  async run(ctx) {
    const dir = ctx.paths.backend
    writeFileSync(
      join(dir, 'README.md'),
      renderBackendReadme({
        request: ctx.request,
        cmsCommit: cmsCommit(ctx),
        backendPort: ctx.state.get().ports.backend,
        subdomainBase: ctx.cfg.subdomainBase,
      }),
    )
    mkdirSync(join(dir, '.github'), { recursive: true })
    writeFileSync(join(dir, '.github', 'dependabot.yml'), renderDependabot('backend'))
    const commit = await commitAll(ctx, dir, `Client README and Dependabot for ${ctx.request.slug}`, {
      step: 'backend-customize',
      body: 'The template README is Payload\'s blank one (runbook F14); Dependabot keeps Next and Payload\nsecurity fixes flowing to this per-client deployment.',
      allowEmpty: !(await hasStepCommit(ctx, dir, 'backend-customize')),
    })
    return outputs({ commit })
  },
  plan: noPlan,
}

/** `pnpm install` probe shared with the site: modules present and installed from the recorded lockfile. */
export function installProbe(dir: string, recordedLockSha: unknown): Probe {
  const lock = fileSha(join(dir, 'pnpm-lock.yaml'))
  if (!existsSync(join(dir, 'node_modules', '.modules.yaml'))) return { state: 'absent' }
  if (!lock || lock !== recordedLockSha) return { state: 'partial', detail: 'lockfile changed since the last install' }
  return { state: 'done' }
}

export const backendInstall: Step = {
  id: 'backend-install',
  runbook: '5',
  phase: 'B',
  crmLogName: 'backend-repo-local',
  outward: false,
  dependsOn: ['backend-copy'],
  fingerprint: (ctx) => fingerprintOf({ lock: fileSha(join(ctx.paths.backend, 'pnpm-lock.yaml')) }),
  probe: async (ctx) => installProbe(ctx.paths.backend, ctx.state.get().steps['backend-install']?.outputs?.lockSha),
  async run(ctx) {
    await ctx.exec.run(['pnpm', 'install', '--frozen-lockfile'], {
      cwd: ctx.paths.backend,
      logFile: ctx.log.stepLog('backend-install'),
      timeoutMs: 15 * 60_000,
      env: { CI: '1' },
    })
    return outputs({ lockSha: fileSha(join(ctx.paths.backend, 'pnpm-lock.yaml')) })
  },
  plan: noPlan,
}

export function backendDbName(ctx: Ctx): string {
  return dbName(ctx.request.slug, ctx.cfg.dbPrefix)
}

export const backendDb: Step = {
  id: 'backend-db',
  runbook: '6',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['preflight'],
  fingerprint: (ctx) => fingerprintOf({ db: backendDbName(ctx) }),
  async probe(ctx) {
    const name = backendDbName(ctx)
    if (!(await ctx.pg.databaseExists(name))) return { state: 'absent' }
    const db = ctx.state.get().db
    if (db?.name === name && db.createdByRun === ctx.state.get().runId) return { state: 'done' }
    return { state: 'conflict', code: 'DB_EXISTS', detail: `database ${name} exists and was not created by run ${ctx.state.get().runId}` }
  },
  async run(ctx) {
    const name = backendDbName(ctx)
    if ((await this.probe(ctx)).state === 'done') return outputs({ name, reused: true })
    // Record the intent first: the probe already proved the DB is absent, so if
    // we crash between CREATE and the next state write, the DB is still ours.
    ctx.state.update((s) => {
      s.db = { name, host: ctx.cfg.postgres.host, port: ctx.cfg.postgres.port, createdByRun: s.runId }
    })
    await ctx.pg.createDatabase(name)
    return outputs({ name })
  },
  plan: noPlan,
}

/** Keys whose presence decides a secret-file step; values are never compared to anything but the store. */
async function keyProbe(ctx: Ctx, file: SecretRef['file'], keys: string[]): Promise<Probe> {
  const have = new Set(await ctx.secrets.keys(file))
  const missing = keys.filter((k) => !have.has(k))
  if (missing.length === 0) return { state: 'done' }
  if (missing.length === keys.length) return { state: 'absent' }
  return { state: 'partial', detail: `missing ${missing.join(', ')}` }
}

function recordSecretNames(ctx: Ctx, file: SecretRef['file'], keys: string[]): void {
  ctx.state.update((s) => {
    s.secrets[file] = [...new Set([...(s.secrets[file] ?? []), ...keys])]
  })
}

export const BACKEND_ENV_KEYS = ['DATABASE_URL', 'PAYLOAD_SECRET', 'PORT', 'PLATFORM_SUBDOMAIN_BASE']

export const backendEnv: Step = {
  id: 'backend-env',
  runbook: '6',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-db', 'backend-copy'],
  // The values are never regenerated, so the fingerprint is the set of keys and the DB name only.
  fingerprint: (ctx) => fingerprintOf({ keys: BACKEND_ENV_KEYS, db: backendDbName(ctx) }),
  probe: (ctx) => keyProbe(ctx, ENV, BACKEND_ENV_KEYS),
  async run(ctx) {
    const s = ctx.state.get()
    await ctx.secrets.ensure(ENV, 'DATABASE_URL', () => ctx.pg.url(backendDbName(ctx)))
    ctx.testHooks?.mid('backend-env')
    await ctx.secrets.ensure(ENV, 'PAYLOAD_SECRET', () => ctx.secrets.generate(32))
    await ctx.secrets.ensure(ENV, 'PORT', () => String(s.ports.backend))
    await ctx.secrets.ensure(ENV, 'PLATFORM_SUBDOMAIN_BASE', () => ctx.cfg.subdomainBase)
    recordSecretNames(ctx, ENV, BACKEND_ENV_KEYS)
    return outputs({ keys: BACKEND_ENV_KEYS })
  },
  plan: noPlan,
}

export const CREDENTIAL_KEYS = [
  'MAKLERI_ADMIN_EMAIL',
  'MAKLERI_ADMIN_PASSWORD',
  'TENANT_SLUG',
  'CLIENT_EMAIL',
  'CLIENT_NAME',
  'CLIENT_PASSWORD',
  'REVALIDATE_SECRET',
]

export const backendCredentials: Step = {
  id: 'backend-credentials',
  runbook: '7',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  irreversible: true,
  dependsOn: ['backend-copy'],
  fingerprint: (ctx) =>
    fingerprintOf({ slug: ctx.request.slug, email: ctx.request.contact.email.toLowerCase(), name: ctx.request.contact.name }),
  probe: (ctx) => keyProbe(ctx, CREDS, CREDENTIAL_KEYS),
  async run(ctx) {
    const { slug, contact } = ctx.request
    // ensure() never overwrites: an existing file keeps every value, only gaps are filled.
    await ctx.secrets.ensure(CREDS, 'MAKLERI_ADMIN_EMAIL', () => `admin+${slug}@realvista.cz`)
    await ctx.secrets.ensure(CREDS, 'MAKLERI_ADMIN_PASSWORD', () => ctx.secrets.generate(24))
    await ctx.secrets.ensure(CREDS, 'TENANT_SLUG', () => slug)
    ctx.testHooks?.mid('backend-credentials')
    await ctx.secrets.ensure(CREDS, 'CLIENT_EMAIL', () => contact.email)
    await ctx.secrets.ensure(CREDS, 'CLIENT_NAME', () => contact.name)
    await ctx.secrets.ensure(CREDS, 'CLIENT_PASSWORD', () => ctx.secrets.generate(18))
    await ctx.secrets.ensure(CREDS, 'REVALIDATE_SECRET', () => ctx.secrets.generate(32))
    recordSecretNames(ctx, CREDS, CREDENTIAL_KEYS)
    return outputs({ keys: CREDENTIAL_KEYS, realtorEmail: contact.email })
  },
  plan: noPlan,
}

/** Env for the cms scripts: DB + Payload secret from .env (they also dotenv it), never on argv. */
export async function backendScriptEnv(ctx: Ctx, extra: Record<string, SecretRef | string> = {}): Promise<Record<string, string>> {
  const env: Record<string, string> = { NODE_ENV: 'development' }
  for (const k of ['DATABASE_URL', 'PAYLOAD_SECRET', 'PLATFORM_SUBDOMAIN_BASE']) {
    const v = await ctx.secrets.get({ file: ENV, key: k })
    if (v === undefined) throw new CwError('PRECONDITION', `backend .env is missing ${k}`, { hint: 'run `cw run` again; backend-env fills gaps' })
    env[k] = v
  }
  for (const [k, ref] of Object.entries(extra)) {
    if (typeof ref === 'string') env[k] = ref
    else {
      const v = await ctx.secrets.get(ref)
      if (v === undefined) throw new CwError('PRECONDITION', `${ref.file} is missing ${ref.key}`)
      env[k] = v
    }
  }
  return env
}

const cred = (key: string): SecretRef => ({ file: CREDS, key })

export const backendMigrate: Step = {
  id: 'backend-migrate',
  runbook: '6',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-env', 'backend-install'],
  fingerprint: (ctx) => fingerprintOf({ cms: ctx.state.get().templates.cms?.commit }),
  // Payload migrate is idempotent and cheap; re-running it is the probe.
  probe: async () => ({ state: 'absent' }),
  async run(ctx) {
    await ctx.exec.run(['pnpm', 'migrate'], {
      cwd: ctx.paths.backend,
      env: await backendScriptEnv(ctx),
      logFile: ctx.log.stepLog('backend-migrate'),
      timeoutMs: 10 * 60_000,
    })
    return {}
  },
  plan: noPlan,
}

export const backendSeedAdmin: Step = {
  id: 'backend-seed-admin',
  runbook: '8',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-migrate', 'backend-credentials'],
  fingerprint: () => fingerprintOf({ v: 1 }),
  async probe(ctx) {
    const email = await ctx.secrets.get(cred('MAKLERI_ADMIN_EMAIL'))
    if (!email) return { state: 'absent' }
    const n = await countRows(ctx, "select count(*)::int as n from users where lower(email) = lower($1) and platform_role = 'platform-admin'", [email])
    return n > 0 ? { state: 'done' } : { state: 'absent' }
  },
  async run(ctx) {
    const r = await ctx.exec.run(['pnpm', 'seed:admin'], {
      cwd: ctx.paths.backend,
      env: await backendScriptEnv(ctx, {
        MAKLERI_ADMIN_EMAIL: cred('MAKLERI_ADMIN_EMAIL'),
        MAKLERI_ADMIN_PASSWORD: cred('MAKLERI_ADMIN_PASSWORD'),
      }),
      logFile: ctx.log.stepLog('backend-seed-admin'),
      timeoutMs: 5 * 60_000,
    })
    return outputs({ result: /Created|Promoted/.exec(r.stdout)?.[0] ?? 'ok' })
  },
  plan: noPlan,
}

export function requestFile(ctx: Ctx): string {
  return join(ctx.paths.record, 'provisioning-request.json')
}
export function starterCopyFile(ctx: Ctx): string {
  return join(ctx.paths.record, 'starter-copy.json')
}

export const backendSeedContent: Step = {
  id: 'backend-seed-content',
  runbook: '8',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-seed-admin', 'starter-copy'],
  fingerprint: (ctx) =>
    fingerprintOf({
      request: fileSha(requestFile(ctx)),
      copy: fileSha(starterCopyFile(ctx)),
      sitePort: ctx.state.get().ports.site,
    }),
  async probe(ctx) {
    const id = await tenantIdBySlug(ctx, ctx.request.slug)
    if (id === null) return { state: 'absent' }
    const settings = await countRows(ctx, 'select count(*)::int as n from site_settings where tenant_id = $1', [id])
    return settings > 0 ? { state: 'done' } : { state: 'partial', detail: 'tenant exists without content' }
  },
  async run(ctx) {
    ctx.testHooks?.mid('backend-seed-content')
    const r = await ctx.exec.run(['pnpm', 'seed:client-site'], {
      cwd: ctx.paths.backend,
      env: await backendScriptEnv(ctx, {
        PROVISIONING_REQUEST: requestFile(ctx),
        STARTER_COPY_JSON: starterCopyFile(ctx),
        TENANT_SLUG: ctx.request.slug,
        SITE_URL: siteUrlLocal(ctx),
        REVALIDATE_SECRET: cred('REVALIDATE_SECRET'),
      }),
      logFile: ctx.log.stepLog('backend-seed-content'),
      timeoutMs: 10 * 60_000,
    })
    const tenantId = Number(parseKv(r.stdout, 'TENANT_ID'))
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new CwError('STEP_FAILED', 'seed:client-site did not print TENANT_ID', { step: 'backend-seed-content' })
    }
    ctx.state.update((s) => {
      s.tenantId = tenantId
    })
    return outputs({ tenantId })
  },
  plan: noPlan,
}

export const backendSeedRealtor: Step = {
  id: 'backend-seed-realtor',
  runbook: '8',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-seed-content'],
  fingerprint: (ctx) => fingerprintOf({ email: ctx.request.contact.email.toLowerCase(), name: ctx.request.contact.name }),
  async probe(ctx) {
    const email = await ctx.secrets.get(cred('CLIENT_EMAIL'))
    return email && (await userExists(ctx, email)) ? { state: 'done' } : { state: 'absent' }
  },
  async run(ctx) {
    const r = await ctx.exec.run(['pnpm', 'seed:client'], {
      cwd: ctx.paths.backend,
      env: await backendScriptEnv(ctx, {
        TENANT_SLUG: ctx.request.slug,
        CLIENT_EMAIL: cred('CLIENT_EMAIL'),
        CLIENT_NAME: cred('CLIENT_NAME'),
        CLIENT_PASSWORD: cred('CLIENT_PASSWORD'),
      }),
      logFile: ctx.log.stepLog('backend-seed-realtor'),
      timeoutMs: 5 * 60_000,
    })
    return outputs({ userId: Number(parseKv(r.stdout, 'CLIENT_USER_ID')) || null })
  },
  plan: noPlan,
}

/** 200/401/403 from the REST API means Payload is up (auth is a separate question). */
export async function backendHealthy(ctx: Ctx): Promise<boolean> {
  const st = await httpStatus(ctx, `${backendUrl(ctx)}/api/site-settings?limit=1`)
  return st === 200 || st === 401 || st === 403
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 1000): Promise<boolean> {
  const end = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return true
    if (Date.now() >= end) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/** Shared probe for a detached local server we own. */
export async function probeServer(ctx: Ctx, name: 'backend' | 'site', healthy: () => Promise<boolean>): Promise<Probe> {
  const s = ctx.state.get()
  const port = s.ports[name]
  const rec = s.processes[name]
  const ours = rec && rec.port === port && ctx.procs.isAlive(rec.pid)
  if (ours && (await healthy())) return { state: 'done' }
  if (ours) return { state: 'partial', detail: `${name} pid ${rec.pid} is alive but not answering on ${port}` }
  if (!(await ctx.procs.isPortFree(port))) {
    const pid = await ctx.procs.pidOnPort(port)
    return { state: 'conflict', code: 'PORT_BUSY', detail: `port ${port} is held by pid ${pid ?? '?'}, not by this run's ${name}` }
  }
  return { state: 'absent' }
}

export async function stopRecorded(ctx: Ctx, name: 'backend' | 'site'): Promise<void> {
  const rec = ctx.state.get().processes[name]
  if (rec && ctx.procs.isAlive(rec.pid)) await ctx.procs.stop(rec.pid)
  ctx.state.update((s) => {
    s.processes[name] = null
  })
}

export async function startServer(
  ctx: Ctx,
  name: 'backend' | 'site',
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  healthy: () => Promise<boolean>,
  timeoutMs: number,
): Promise<{ pid: number; port: number }> {
  const port = ctx.state.get().ports[name]
  const logFile = join(ctx.log.dir, `${name}.log`)
  const { pid } = await ctx.procs.startDetached({ name, argv, cwd, env, logFile, port })
  ctx.state.update((s) => {
    s.processes[name] = { pid, port, log: logFile, startedAt: nowIso() }
  })
  if (!(await waitFor(healthy, timeoutMs))) {
    throw new CwError('STEP_FAILED', `${name} did not come up on port ${port} within ${Math.round(timeoutMs / 1000)} s`, {
      hint: `see ${logFile}`,
    })
  }
  return { pid, port }
}

export const backendStart: Step = {
  id: 'backend-start',
  runbook: '9',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-migrate'],
  fingerprint: (ctx) => fingerprintOf({ port: ctx.state.get().ports.backend }),
  probe: (ctx) => probeServer(ctx, 'backend', () => backendHealthy(ctx)),
  recover: (ctx) => stopRecorded(ctx, 'backend'),
  async run(ctx) {
    const port = ctx.state.get().ports.backend
    // A healthy backend we started is reused, never restarted for nothing.
    if ((await probeServer(ctx, 'backend', () => backendHealthy(ctx))).state === 'done') {
      const rec = ctx.state.get().processes.backend!
      return outputs({ pid: rec.pid, port: rec.port, reused: true })
    }
    await stopRecorded(ctx, 'backend')
    // PORT on the command line: `next dev` ignores PORT from .env (runbook F12).
    const r = await startServer(
      ctx,
      'backend',
      ['pnpm', 'exec', 'next', 'dev', '--port', String(port)],
      ctx.paths.backend,
      await backendScriptEnv(ctx, { PORT: String(port), NODE_OPTIONS: '--no-deprecation' }),
      () => backendHealthy(ctx),
      180_000,
    )
    return outputs(r)
  },
  plan: noPlan,
}

// ---------------------------------------------------------------------------
// site-key (runbook 10): minted once, re-minted only when the stored key stops authenticating.

export const SITE_KEY: SecretRef = { file: CREDS, key: 'SITE_CMS_API_KEY' }

export async function siteKeyAuthenticates(ctx: Ctx, key: string): Promise<boolean> {
  const st = await httpStatus(ctx, `${backendUrl(ctx)}/api/site-settings?limit=1`, { Authorization: `users API-Key ${key}` })
  return st === 200
}

export const siteKey: Step = {
  id: 'site-key',
  runbook: '10',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-start', 'backend-seed-content'],
  fingerprint: (ctx) => fingerprintOf({ slug: ctx.request.slug }),
  async probe(ctx) {
    const key = await ctx.secrets.get(SITE_KEY)
    if (!key) return { state: 'absent' }
    if (await siteKeyAuthenticates(ctx, key)) return { state: 'done' }
    return { state: 'partial', detail: 'the stored site key no longer authenticates; it will be re-minted' }
  },
  async run(ctx) {
    // Never re-mint a key that still works: the site and its build depend on it.
    const existing = await ctx.secrets.get(SITE_KEY)
    if (existing && (await siteKeyAuthenticates(ctx, existing))) {
      const at = new Date().toISOString()
      ctx.state.update((s) => {
        s.siteKey = { mintedAt: s.siteKey?.mintedAt ?? at, verifiedAt: at }
      })
      return outputs({ mintedAt: ctx.state.get().siteKey!.mintedAt, reused: true })
    }
    if (!(await backendHealthy(ctx))) {
      throw new CwError('STEP_FAILED', 'the backend is not running; site-key needs it', { hint: '`cw run` restarts it' })
    }
    // The key goes to a 0600 file (M3), never to stdout.
    const out = join(ctx.log.dir, `.site-key-${process.pid}.tmp`)
    mkdirSync(dirname(out), { recursive: true })
    try {
      const r = await ctx.exec.run(['pnpm', 'seed:site-key'], {
        cwd: ctx.paths.backend,
        env: await backendScriptEnv(ctx, {
          TENANT_SLUG: ctx.request.slug,
          CMS_PROBE_URL: backendUrl(ctx),
          SITE_KEY_OUT: out,
        }),
        logFile: ctx.log.stepLog('site-key'),
        timeoutMs: 5 * 60_000,
      })
      const key = readSiteKeyFile(out)
      if (!key) throw new CwError('STEP_FAILED', 'seed:site-key wrote no key', { step: 'site-key' })
      ctx.secrets.register(key)
      ctx.testHooks?.mid('site-key')
      await ctx.secrets.set(SITE_KEY, key)
      recordSecretNames(ctx, CREDS, [SITE_KEY.key])
      const tenantId = Number(parseKv(r.stdout, 'TENANT_ID'))
      const at = nowIso()
      ctx.state.update((s) => {
        s.siteKey = { mintedAt: at, verifiedAt: at }
        if (Number.isInteger(tenantId) && tenantId > 0) s.tenantId = tenantId
      })
      return outputs({ mintedAt: at })
    } finally {
      rmSync(out, { force: true })
    }
  },
  plan: noPlan,
}

/** M3 writes either the bare key or `CMS_API_KEY=<key>` lines. */
export function readSiteKeyFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8').trim()
  const m = /^CMS_API_KEY=(.+)$/m.exec(text)
  const key = (m ? m[1]! : text.split('\n')[0]!).trim().replace(/^"|"$/g, '')
  return key || undefined
}

export const BACKEND_STEPS: Step[] = [
  backendCopy,
  backendCustomize,
  backendInstall,
  backendDb,
  backendEnv,
  backendCredentials,
  backendMigrate,
  backendSeedAdmin,
  backendSeedContent,
  backendSeedRealtor,
  backendStart,
  siteKey,
]
