/**
 * Phase A (preflight, input, record repo) and the starter-copy step.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { formatIssues, initStarterCopy, validateStarterCopy } from '../copy/index.js'
import type { Ctx, Probe, Step } from '../types.js'
import { CwError } from '../types.js'
import { commitAll, fileSha, fingerprintOf, gitInit, hasStepCommit, outputs, stableJson } from './util.js'

/** cms scripts the steps call; a template without them cannot be provisioned. */
export const REQUIRED_CMS_SCRIPTS = ['migrate', 'seed:admin', 'seed:client-site', 'seed:client', 'seed:site-key']
export const MIN_TEMPLATE_API = 1
export const PLATFORM_MANIFEST = 'apps/site/realvista-template.json'
export const CMS_MANIFEST = 'realvista-template.json'

async function gitOut(ctx: Ctx, cwd: string, args: string[]): Promise<string | null> {
  const r = await ctx.exec.run(['git', ...args], { cwd, allowFailure: true })
  return r.code === 0 ? r.stdout : null
}

/**
 * Reads one committed file. Not via `git show` stdout: Exec redacts child
 * output (e.g. `…_PASSWORD=1",` loses its closing quote), which corrupts JSON.
 * `git archive` to a file and a plain fs read keep the bytes intact.
 */
export async function readCommittedFile(ctx: Ctx, repo: string, sha: string, path: string): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'cw-manifest-'))
  try {
    const tar = join(dir, 'f.tar')
    const a = await ctx.exec.run(['git', 'archive', '--format=tar', '-o', tar, sha, path], { cwd: repo, allowFailure: true })
    if (a.code !== 0) return null
    const x = await ctx.exec.run(['tar', '-xf', tar, '-C', dir], { cwd: dir, allowFailure: true })
    if (x.code !== 0 || !existsSync(join(dir, path))) return null
    return readFileSync(join(dir, path), 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function readManifest(ctx: Ctx, repo: string, sha: string, path: string): Promise<Record<string, unknown> | null> {
  const text = await readCommittedFile(ctx, repo, sha, path)
  if (text === null) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Pins template SHAs once; a resume always reuses them even if `main` moved. */
export async function pinTemplates(ctx: Ctx): Promise<void> {
  const s = ctx.state.get()
  if (!s.templates.cms) {
    const sha = (await gitOut(ctx, ctx.cfg.cmsRepo, ['rev-parse', '--verify', `${ctx.cfg.cmsRef}^{commit}`]))?.trim()
    if (!sha) throw new CwError('TEMPLATE_TOO_OLD', `cannot resolve ${ctx.cfg.cmsRef} in ${ctx.cfg.cmsRepo}`, { hint: 'check cmsRepo/cmsRef in create-website.config.json' })
    ctx.state.update((st) => {
      st.templates.cms = { repo: ctx.cfg.cmsRepo, commit: sha }
    })
  }
  if (!s.templates.platform) {
    const sha = (await gitOut(ctx, ctx.cfg.platformRepo, ['rev-parse', '--verify', 'HEAD^{commit}']))?.trim()
    if (!sha) throw new CwError('TEMPLATE_TOO_OLD', `cannot resolve HEAD in ${ctx.cfg.platformRepo}`)
    const theme = await readManifest(ctx, ctx.cfg.platformRepo, sha, 'packages/theme-realvista/package.json')
    ctx.state.update((st) => {
      st.templates.platform = {
        repo: ctx.cfg.platformRepo,
        commit: sha,
        ...(theme?.version ? { themeVersion: `realvista@${String(theme.version)}` } : {}),
      }
    })
  }
}

export async function checkManifests(ctx: Ctx): Promise<string[]> {
  const warnings: string[] = []
  const { cms, platform } = ctx.state.get().templates
  const cm = await readManifest(ctx, ctx.cfg.cmsRepo, cms!.commit, CMS_MANIFEST)
  const api = Number(cm?.templateApiVersion ?? 0)
  if (!cm || cm.template !== 'realvista-client-backend' || api < MIN_TEMPLATE_API) {
    throw new CwError('TEMPLATE_TOO_OLD', `cms@${cms!.commit.slice(0, 7)} has no ${CMS_MANIFEST} with templateApiVersion ≥ ${MIN_TEMPLATE_API}`, {
      hint: 'The cms template needs M1–M4 merged; or point cmsRef at the branch that has them.',
    })
  }
  const scripts = Array.isArray(cm.scripts) ? (cm.scripts as string[]) : []
  const missing = REQUIRED_CMS_SCRIPTS.filter((x) => !scripts.includes(x))
  if (missing.length) throw new CwError('TEMPLATE_TOO_OLD', `cms template lacks script(s): ${missing.join(', ')}`)
  ctx.state.update((st) => {
    st.templates.cms!.templateApiVersion = api
  })
  const pm = await readManifest(ctx, ctx.cfg.platformRepo, platform!.commit, PLATFORM_MANIFEST)
  if (!pm || Number(pm.templateApiVersion ?? 0) < MIN_TEMPLATE_API) {
    throw new CwError('TEMPLATE_TOO_OLD', `platform@${platform!.commit.slice(0, 7)} has no ${PLATFORM_MANIFEST} with templateApiVersion ≥ ${MIN_TEMPLATE_API}`, {
      hint: 'The platform prerequisites (P1–P4) must be on the checked-out platform commit.',
    })
  }
  for (const [name, repo] of [['cms', ctx.cfg.cmsRepo], ['platform', ctx.cfg.platformRepo]] as const) {
    const dirty = await gitOut(ctx, repo, ['status', '--porcelain'])
    if (dirty && dirty.trim()) warnings.push(`${name} checkout has uncommitted changes; they are NOT included (git archive of the pinned commit)`)
  }
  return warnings
}

export const preflight: Step = {
  id: 'preflight',
  runbook: '(new)',
  phase: 'A',
  outward: false,
  dependsOn: [],
  fingerprint: () => fingerprintOf({ v: 1 }),
  probe: async () => ({ state: 'absent' }),
  async run(ctx) {
    const major = Number(process.versions.node.split('.')[0])
    if (major < 22) throw new CwError('TOOL_MISSING', `node ${process.versions.node} is too old; need ≥ 22`)
    for (const tool of ['pnpm', 'git'] as const) {
      const r = await ctx.exec.run([tool, '--version'], { cwd: ctx.cfg.rootDir, allowFailure: true }).catch(() => ({ code: 127 }))
      if (r.code !== 0) throw new CwError('TOOL_MISSING', `${tool} is not available on PATH`)
    }
    try {
      await ctx.pg.ping()
    } catch (e) {
      throw new CwError('POSTGRES_UNREACHABLE', `Postgres at ${ctx.cfg.postgres.host}:${ctx.cfg.postgres.port} is not reachable`, {
        hint: 'start it (e.g. `brew services start postgresql@17`) and run `cw run` again',
        cause: e,
      })
    }
    await pinTemplates(ctx)
    const warnings = await checkManifests(ctx)
    for (const w of warnings) ctx.log.warn(w)
    // Ports: free, or held by the server this run started earlier.
    const s = ctx.state.get()
    for (const name of ['backend', 'site'] as const) {
      const port = s.ports[name]
      if (ctx.cfg.ports.reserved.includes(port)) throw new CwError('PORT_BUSY', `port ${port} is reserved in the config`)
      const rec = s.processes[name]
      const ours = rec && rec.port === port && ctx.procs.isAlive(rec.pid)
      if (!ours && !(await ctx.procs.isPortFree(port))) {
        throw new CwError('PORT_BUSY', `port ${port} (${name}) is in use by pid ${(await ctx.procs.pidOnPort(port)) ?? '?'}`, {
          hint: 'stop that process, or pass --site-port/--backend-port',
        })
      }
    }
    return outputs({ node: process.versions.node, cms: s.templates.cms?.commit, platform: s.templates.platform?.commit, warnings })
  },
  plan: () => [],
}

export function requestJsonText(ctx: Ctx): string {
  return JSON.stringify(ctx.request, null, 2) + '\n'
}
export function provisioningJsonText(ctx: Ctx): string {
  return JSON.stringify(ctx.request.provisioning, null, 2) + '\n'
}

function sameJsonFile(path: string, value: unknown): boolean | null {
  if (!existsSync(path)) return null
  try {
    return stableJson(JSON.parse(readFileSync(path, 'utf8'))) === stableJson(value)
  } catch {
    return false
  }
}

export const input: Step = {
  id: 'input',
  runbook: '4',
  phase: 'A',
  crmLogName: 'provisioning-json',
  outward: false,
  dependsOn: ['preflight'],
  fingerprint: (ctx) => fingerprintOf({ request: stableJson(ctx.request) }),
  async probe(ctx): Promise<Probe> {
    const req = sameJsonFile(join(ctx.paths.record, 'provisioning-request.json'), ctx.request)
    const prov = sameJsonFile(join(ctx.paths.record, 'provisioning.json'), ctx.request.provisioning)
    if (req === false) {
      return { state: 'conflict', code: 'INPUT_CHANGED', detail: `clients/${ctx.request.slug}/provisioning-request.json holds a different request` }
    }
    if (req && prov) return { state: 'done' }
    return req || prov ? { state: 'partial', detail: 'one of the two input files is missing' } : { state: 'absent' }
  },
  async run(ctx) {
    mkdirSync(ctx.paths.record, { recursive: true })
    writeFileSync(join(ctx.paths.record, 'provisioning-request.json'), requestJsonText(ctx))
    writeFileSync(join(ctx.paths.record, 'provisioning.json'), provisioningJsonText(ctx))
    return outputs({
      requestFileSha: fileSha(join(ctx.paths.record, 'provisioning-request.json')),
      theme: `${ctx.request.provisioning.theme.name}/${ctx.request.provisioning.theme.variant}`,
    })
  },
  plan: () => [],
}

export const RECORD_GITIGNORE = `# create-website: run logs and the lock are local; the state file is committed (no secrets in it)
logs/
.create-website.lock
.*.tmp-*
# never in this repo, but the commit guard requires every secret name ignored everywhere
.env
.env.*
.admin-credentials.local
`

export const recordRepo: Step = {
  id: 'record-repo',
  runbook: '(record)',
  phase: 'A',
  outward: false,
  dependsOn: ['input', 'crm-site-record'],
  fingerprint: (ctx) => fingerprintOf({ request: stableJson(ctx.request) }),
  probe: async (ctx) => ((await hasStepCommit(ctx, ctx.paths.record, 'record-repo')) ? { state: 'done' } : { state: 'absent' }),
  async run(ctx) {
    const dir = ctx.paths.record
    mkdirSync(dir, { recursive: true })
    if (await hasStepCommit(ctx, dir, 'record-repo')) return outputs({ reused: true })
    await gitInit(ctx, dir)
    writeFileSync(join(dir, '.gitignore'), RECORD_GITIGNORE)
    const b = ctx.request.provisioning.brand.name
    const crm = ctx.request.crm ? ` (CRM lead ${ctx.request.crm.leadId}, site ${ctx.request.crm.siteId})` : ''
    const commit = await commitAll(ctx, dir, `Provisioning record for ${ctx.request.slug}: ${b}${crm}`, {
      step: 'record-repo',
      body: 'The request envelope and the provisioning JSON exactly as validated; everything\nelse for this client is generated from them.',
      allowEmpty: true,
    })
    return outputs({ commit })
  },
  plan: () => [],
}

/** Commit the state file (and the outward plan) into the record repo. No secrets live there. */
export async function commitRecord(ctx: Ctx, subject: string, step: 'outward-plan' | 'handover'): Promise<string | null> {
  if (!existsSync(join(ctx.paths.record, '.git'))) return null
  return commitAll(ctx, ctx.paths.record, subject, { step })
}

export const starterCopy: Step = {
  id: 'starter-copy',
  runbook: '8 (copy)',
  phase: 'B',
  crmLogName: 'backend-seed',
  outward: false,
  dependsOn: ['backend-install'],
  // Not the file's sha: the step creates the file, and Claude's edits re-seed via backend-seed-content's fingerprint.
  fingerprint: (ctx) => fingerprintOf({ tone: ctx.request.provisioning.content.tone, slug: ctx.request.slug }),
  async probe(ctx) {
    if (!existsSync(join(ctx.paths.record, 'starter-copy.json'))) return { state: 'absent' }
    const v = await validateStarterCopy({ recordDir: ctx.paths.record, backendDir: ctx.paths.backend, request: ctx.request })
    return v.ok ? { state: 'done' } : { state: 'partial', detail: `starter-copy.json has ${v.issues.length} issue(s)` }
  },
  async run(ctx) {
    const o = { recordDir: ctx.paths.record, backendDir: ctx.paths.backend, request: ctx.request }
    const init = await initStarterCopy(o)
    const v = await validateStarterCopy(o)
    if (!v.ok) {
      throw new CwError('INVALID_STARTER_COPY', `starter-copy.json is invalid:\n${formatIssues(v.issues)}`, {
        step: 'starter-copy',
        hint: 'Fix the listed fields (references/czech-copy.md), run `cw copy validate`, then `cw run`.',
        details: v.issues.map((i) => ({ path: i.path, message: i.message })),
      })
    }
    return outputs({ created: init.created, sha: fileSha(v.path) })
  },
  plan: () => [],
}
