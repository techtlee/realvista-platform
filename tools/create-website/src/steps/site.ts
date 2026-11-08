/**
 * Phase C: site-<slug> (runbook steps 10–12). The export itself is WP5's
 * exporter; these steps wrap it with probes, env, install, build and start.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { computeClosure, exportSite, makeStandalone, planDependencies, siteConfigInputFor } from '../site/index.js'
import type { Ctx, Probe, SecretRef, Step } from '../types.js'
import { CwError } from '../types.js'
import {
  SITE_KEY,
  backendHealthy,
  backendStart,
  installProbe,
  probeServer,
  probeTemplateCopy,
  recoverTmp,
  startServer,
  stopRecorded,
} from './backend.js'
import {
  commitAll,
  fileSha,
  fingerprintOf,
  hasStepCommit,
  headCommit,
  httpStatus,
  outputs,
  siteUrlLocal,
} from './util.js'

const SITE_ENV: SecretRef['file'] = 'site/.env.local'

function platformCommit(ctx: Ctx): string {
  const c = ctx.state.get().templates.platform?.commit
  if (!c) throw new CwError('PRECONDITION', 'platform template commit is not pinned in state', { hint: 'preflight pins it; run `cw run` again' })
  return c
}

function standaloneInputs(ctx: Ctx) {
  const s = ctx.state.get()
  return { request: ctx.request, ports: s.ports, subdomainBase: ctx.cfg.subdomainBase, tenantId: s.tenantId }
}

export const siteCopy: Step = {
  id: 'site-copy',
  runbook: '11',
  phase: 'C',
  crmLogName: 'site-repo-local',
  outward: false,
  dependsOn: ['record-repo'],
  fingerprint: (ctx) => fingerprintOf({ platform: ctx.state.get().templates.platform?.commit }),
  probe: (ctx) => probeTemplateCopy(ctx, ctx.paths.site, `platform@${platformCommit(ctx)}`, 'site'),
  recover: (ctx) => recoverTmp(ctx, 'site'),
  async run(ctx) {
    const expected = `platform@${platformCommit(ctx)}`
    if ((await probeTemplateCopy(ctx, ctx.paths.site, expected, 'site')).state === 'done') return outputs({ template: expected, reused: true })
    ctx.testHooks?.mid('site-copy')
    // exportSite writes both commits (pristine + standalone) in a temp dir and
    // renames it into place, so the target is never half-written.
    const r = await exportSite({
      platformRoot: ctx.cfg.platformRepo,
      commit: platformCommit(ctx),
      outDir: ctx.paths.site,
      runId: ctx.state.get().runId,
      ...standaloneInputs(ctx),
    })
    return outputs({ pristine: r.commits.pristine, standalone: r.commits.standalone, files: r.files, siteUrl: r.siteUrl })
  },
  plan: () => [],
}

/**
 * Normally a no-op after site-copy (the exporter already committed the
 * standalone rewrite). It re-applies the rewrite on an existing copy when its
 * inputs changed (ports, request, tenant id) and commits only if the content differs.
 */
export const siteStandalone: Step = {
  id: 'site-standalone',
  runbook: '11 (table)',
  phase: 'C',
  crmLogName: 'site-repo-local',
  outward: false,
  dependsOn: ['site-copy', 'input'],
  fingerprint: (ctx) => {
    const s = ctx.state.get()
    return fingerprintOf({ request: fileSha(join(ctx.paths.record, 'provisioning-request.json')), ports: s.ports, platform: s.templates.platform?.commit, base: ctx.cfg.subdomainBase })
  },
  probe: async (ctx) => ((await hasStepCommit(ctx, ctx.paths.site, 'site-standalone')) ? { state: 'done' } : { state: 'absent' }),
  async run(ctx) {
    const sha = platformCommit(ctx)
    const closure = await computeClosure(ctx.cfg.platformRepo, sha)
    try {
      const deps = await planDependencies(closure)
      const siteConfig = siteConfigInputFor(ctx.request, standaloneInputs(ctx))
      await makeStandalone(closure, ctx.paths.site, {
        platformRoot: ctx.cfg.platformRepo,
        commit: sha,
        outDir: ctx.paths.site,
        ...standaloneInputs(ctx),
        sha,
        siteConfig,
        deps,
      } as Parameters<typeof makeStandalone>[2])
    } finally {
      const { rmSync } = await import('node:fs')
      rmSync(closure.treeRoot, { recursive: true, force: true })
    }
    const commit = await commitAll(ctx, ctx.paths.site, `Regenerate the standalone config for ${ctx.request.slug}`, {
      step: 'site-standalone',
      body: 'Inputs changed (request, ports or template); regenerated from the same exporter.',
      allowEmpty: !(await hasStepCommit(ctx, ctx.paths.site, 'site-standalone')),
    })
    return outputs({ commit })
  },
  plan: () => [],
}

export async function expectedSiteEnv(ctx: Ctx): Promise<Record<string, string>> {
  const s = ctx.state.get()
  const key = await ctx.secrets.get(SITE_KEY)
  const rev = await ctx.secrets.get({ file: 'backend/.admin-credentials.local', key: 'REVALIDATE_SECRET' })
  if (!key || !rev) throw new CwError('PRECONDITION', 'site key or revalidate secret missing from the backend credentials', { hint: '`cw run` re-runs site-key' })
  if (!s.tenantId) throw new CwError('PRECONDITION', 'tenant id unknown; backend-seed-content has not run')
  return {
    NEXT_PUBLIC_CMS_URL: `http://localhost:${s.ports.backend}`,
    TENANT_ID: String(s.tenantId),
    CMS_API_KEY: key,
    REVALIDATE_SECRET: rev,
  }
}

export const siteEnv: Step = {
  id: 'site-env',
  runbook: '10/11',
  phase: 'C',
  crmLogName: 'site-repo-local',
  outward: false,
  dependsOn: ['site-copy', 'site-key', 'backend-seed-content'],
  fingerprint: (ctx) => {
    const s = ctx.state.get()
    return fingerprintOf({ backend: s.ports.backend, tenant: s.tenantId, minted: s.siteKey?.mintedAt })
  },
  async probe(ctx): Promise<Probe> {
    if (!existsSync(ctx.secrets.pathOf(SITE_ENV))) return { state: 'absent' }
    const want = await expectedSiteEnv(ctx)
    for (const [k, v] of Object.entries(want)) {
      if ((await ctx.secrets.get({ file: SITE_ENV, key: k })) !== v) return { state: 'partial', detail: `${k} differs or is missing` }
    }
    return { state: 'done' }
  },
  async run(ctx) {
    const want = await expectedSiteEnv(ctx)
    // An explicit rewrite (set), unlike credentials: these values are derived, never original.
    for (const [k, v] of Object.entries(want)) await ctx.secrets.set({ file: SITE_ENV, key: k }, v)
    ctx.state.update((s) => {
      s.secrets[SITE_ENV] = Object.keys(want)
    })
    return outputs({ keys: Object.keys(want) })
  },
  plan: () => [],
}

export const siteInstall: Step = {
  id: 'site-install',
  runbook: '12',
  phase: 'C',
  crmLogName: 'site-repo-local',
  outward: false,
  dependsOn: ['site-standalone'],
  fingerprint: (ctx) => fingerprintOf({ pkg: fileSha(join(ctx.paths.site, 'package.json')) }),
  async probe(ctx) {
    const p = installProbe(ctx.paths.site, ctx.state.get().steps['site-install']?.outputs?.lockSha)
    if (p.state !== 'done') return p
    return (await hasStepCommit(ctx, ctx.paths.site, 'site-install')) ? p : { state: 'partial', detail: 'lockfile not committed' }
  },
  async run(ctx) {
    await ctx.exec.run(['pnpm', 'install'], {
      cwd: ctx.paths.site,
      logFile: ctx.log.stepLog('site-install'),
      timeoutMs: 15 * 60_000,
      env: { CI: '1' },
    })
    const commit = await commitAll(ctx, ctx.paths.site, 'Lockfile from the first install', {
      step: 'site-install',
      body: 'Pins the full dependency tree the client site was built and verified with.',
      allowEmpty: !(await hasStepCommit(ctx, ctx.paths.site, 'site-install')),
    })
    return outputs({ lockSha: fileSha(join(ctx.paths.site, 'pnpm-lock.yaml')), commit })
  },
  plan: () => [],
}

const BUILD_FP_FILE = join('.next', 'cw-build-fingerprint')

function readHead(dir: string): string | null {
  try {
    const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim()
    const m = /^ref: (.+)$/.exec(head)
    if (!m) return head
    const ref = join(dir, '.git', m[1]!)
    if (existsSync(ref)) return readFileSync(ref, 'utf8').trim()
    const packed = join(dir, '.git', 'packed-refs')
    if (!existsSync(packed)) return null
    const line = readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(` ${m[1]}`))
    return line?.split(' ')[0] ?? null
  } catch {
    return null
  }
}

/** Commit + env identity (no secret values: the key's mint time stands in for the key). */
export function buildFingerprint(ctx: Ctx): string {
  const s = ctx.state.get()
  return fingerprintOf({ head: readHead(ctx.paths.site), backend: s.ports.backend, tenant: s.tenantId, minted: s.siteKey?.mintedAt })
}

export const siteBuild: Step = {
  id: 'site-build',
  runbook: '12, F11',
  phase: 'C',
  crmLogName: 'site-repo-local',
  outward: false,
  dependsOn: ['site-install', 'site-env', 'backend-start'],
  fingerprint: buildFingerprint,
  async probe(ctx) {
    const id = join(ctx.paths.site, '.next', 'BUILD_ID')
    const fp = join(ctx.paths.site, BUILD_FP_FILE)
    if (!existsSync(id)) return { state: 'absent' }
    if (!existsSync(fp) || readFileSync(fp, 'utf8').trim() !== buildFingerprint(ctx)) return { state: 'partial', detail: 'build is older than the current commit/env' }
    return { state: 'done' }
  },
  async run(ctx) {
    // The build prerenders from the backend (runbook F11): make sure it is up.
    if (!(await backendHealthy(ctx))) {
      ctx.log.warn('backend not healthy before site-build; restarting it')
      await stopRecorded(ctx, 'backend')
      await backendStart.run(ctx)
    }
    await ctx.exec.run(['pnpm', 'build'], {
      cwd: ctx.paths.site,
      env: { NEXT_TELEMETRY_DISABLED: '1' },
      logFile: ctx.log.stepLog('site-build'),
      timeoutMs: 20 * 60_000,
    })
    const fp = buildFingerprint(ctx)
    writeFileSync(join(ctx.paths.site, BUILD_FP_FILE), fp + '\n')
    return outputs({ fingerprint: fp, commit: await headCommit(ctx, ctx.paths.site) })
  },
  plan: () => [],
}

export async function siteServesVariant(ctx: Ctx): Promise<boolean> {
  try {
    const r = await ctx.http.request({ url: `${siteUrlLocal(ctx)}/`, timeoutMs: 10_000 })
    return r.status === 200 && r.text.includes(`data-variant="${ctx.request.provisioning.theme.variant}"`)
  } catch {
    return false
  }
}

export const siteStart: Step = {
  id: 'site-start',
  runbook: '12',
  phase: 'C',
  crmLogName: 'site-repo-local',
  outward: false,
  dependsOn: ['site-build'],
  fingerprint: (ctx) => fingerprintOf({ port: ctx.state.get().ports.site, build: buildFingerprint(ctx) }),
  probe: (ctx) => probeServer(ctx, 'site', () => siteServesVariant(ctx)),
  recover: (ctx) => stopRecorded(ctx, 'site'),
  async run(ctx) {
    // A stale server from an older build would keep serving old pages.
    await stopRecorded(ctx, 'site')
    const port = ctx.state.get().ports.site
    const r = await startServer(
      ctx,
      'site',
      ['pnpm', 'exec', 'next', 'start', '--port', String(port)],
      ctx.paths.site,
      { PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
      () => siteServesVariant(ctx),
      90_000,
    )
    return outputs({ ...r, url: siteUrlLocal(ctx), status: await httpStatus(ctx, `${siteUrlLocal(ctx)}/`) })
  },
  plan: () => [],
}

export const SITE_STEPS: Step[] = [siteCopy, siteStandalone, siteEnv, siteInstall, siteBuild, siteStart]
