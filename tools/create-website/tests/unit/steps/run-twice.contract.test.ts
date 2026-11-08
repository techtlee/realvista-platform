/**
 * Contract: for EVERY local step, calling run() a second time on the world
 * the first call left behind changes nothing. The runner calls run() whenever
 * state is not `done` (crash between the work and the state write, or work a
 * previous step already did), so idempotency must hold inside each step.
 *
 * Side effects measured after each call: commits per repo (by hash, so also
 * by trailer), the content of every secret file and record file, databases
 * created, processes started, and every mutating command (installs, seeds,
 * migrate, build, site-key mint), plus the fake backend DB's users/tenants.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/site/index.js', async () => {
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const path = await import('node:path')
  const g = (cwd: string, ...a: string[]) =>
    execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  return {
    exportSite: async (o: { outDir: string; commit: string }) => {
      fs.mkdirSync(o.outDir, { recursive: true })
      fs.writeFileSync(path.join(o.outDir, '.gitignore'), 'node_modules/\n.next/\n.env\n.env*.local\n')
      fs.writeFileSync(path.join(o.outDir, 'package.json'), '{"name":"site"}\n')
      g(o.outDir, 'init', '-q', '-b', 'main')
      g(o.outDir, 'add', '-A')
      g(o.outDir, 'commit', '-q', '-m', `pristine\n\nCreate-Website-Template: platform@${o.commit}`)
      fs.writeFileSync(path.join(o.outDir, 'site.config.ts'), 'export default {}\n')
      g(o.outDir, 'add', '-A')
      g(o.outDir, 'commit', '-q', '-m', 'standalone\n\nCreate-Website-Step: site-standalone')
      return { commits: { pristine: 'p', standalone: 's' }, files: 2, siteUrl: 'https://x' }
    },
    computeClosure: async () => ({ treeRoot: '/nonexistent-cw-test' }),
    makeStandalone: async () => ({ files: 0 }),
    planDependencies: async () => ({ dependencies: {}, devDependencies: {} }),
    siteConfigInputFor: () => ({ pages: { home: { sections: ['hero'] } } }),
  }
})
vi.mock('../../../src/verify/checks.js', () => ({
  runChecks: async () => [{ check: 'all', ok: true, detail: 'mocked' }],
}))

import { setBackendQueryFactory } from '../../../src/backend/db.js'
import { STEPS } from '../../../src/steps/registry.js'
import type { StepId } from '../../../src/types.js'
import { git, makeCmsRepo, makeWorld, ok, type World } from './helpers.js'

/** The fake backend: what the cms seed scripts would upsert. */
interface Db {
  migrations: Set<string>
  users: Map<string, { role: string }>
  tenants: Map<string, number>
  settings: Set<number>
  siteKey: string | null
}

const sha = (p: string) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12) : null)

function installFakes(w: World, db: Db): void {
  const be = w.ctx.paths.backend
  const site = w.ctx.paths.site
  setBackendQueryFactory(() => async (sql, params = []) => {
    if (sql.includes('payload_migrations')) return [...db.migrations].map((name) => ({ name }))
    if (sql.includes('from tenants')) {
      const id = db.tenants.get(String(params[0]))
      return id ? [{ id }] : []
    }
    if (sql.includes('from site_settings')) return [{ n: db.settings.has(Number(params[0])) ? 1 : 0 }]
    if (sql.includes('from users')) {
      const u = db.users.get(String(params[0]).toLowerCase())
      const wantAdmin = sql.includes('platform-admin')
      return [{ n: u && (!wantAdmin || u.role === 'platform-admin') ? 1 : 0 }]
    }
    return []
  })
  w.exec.handlers.push((argv, opts) => {
    const cmd = argv.join(' ')
    const env = opts.env ?? {}
    if (cmd === 'pnpm --version') return { code: 0, stdout: '12.6.0', stderr: '' }
    if (cmd.startsWith('pnpm install')) {
      mkdirSync(join(opts.cwd, 'node_modules'), { recursive: true })
      writeFileSync(join(opts.cwd, 'node_modules', '.modules.yaml'), 'x')
      if (!existsSync(join(opts.cwd, 'pnpm-lock.yaml'))) writeFileSync(join(opts.cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
      return { code: 0, stdout: '', stderr: '' }
    }
    if (cmd === 'pnpm migrate') {
      db.migrations.add('20261108_100819_baseline')
      return { code: 0, stdout: '', stderr: '' }
    }
    if (cmd === 'pnpm seed:admin') {
      db.users.set(env.MAKLERI_ADMIN_EMAIL!.toLowerCase(), { role: 'platform-admin' })
      return { code: 0, stdout: 'Created platform-admin', stderr: '' }
    }
    if (cmd === 'pnpm seed:client-site') {
      const slug = env.TENANT_SLUG ?? JSON.parse(readFileSync(env.PROVISIONING_REQUEST!, 'utf8')).slug
      const id = db.tenants.get(slug) ?? db.tenants.size + 1
      db.tenants.set(slug, id)
      db.settings.add(id)
      return { code: 0, stdout: `TENANT_ID=${id}\n# todo`, stderr: '' }
    }
    if (cmd === 'pnpm seed:client') {
      db.users.set(env.CLIENT_EMAIL!.toLowerCase(), { role: 'client' })
      return { code: 0, stdout: 'CLIENT_USER_ID=2', stderr: '' }
    }
    if (cmd === 'pnpm seed:site-key') {
      db.siteKey = `key-${Math.random().toString(36).slice(2)}-${Date.now()}`
      writeFileSync(env.SITE_KEY_OUT!, db.siteKey, { mode: 0o600 })
      return { code: 0, stdout: `TENANT_ID=${db.tenants.get(w.ctx.request.slug)}`, stderr: '' }
    }
    if (cmd === 'pnpm build') {
      mkdirSync(join(site, '.next'), { recursive: true })
      writeFileSync(join(site, '.next', 'BUILD_ID'), 'b')
      return { code: 0, stdout: '', stderr: '' }
    }
    return undefined
  })
  w.http.routes.push((r) => {
    if (r.url.startsWith(`http://localhost:${w.state.get().ports.backend}/api/site-settings`)) {
      const auth = r.headers?.Authorization
      return ok(auth ? (db.siteKey && auth === `users API-Key ${db.siteKey}` ? 200 : 403) : 403)
    }
    if (r.url === `http://localhost:${w.state.get().ports.site}/`) return ok(200, `<html data-variant="${w.ctx.request.provisioning.theme.variant}">`)
    return undefined
  })
  void be
}

// tar only ever extracts into a temp dir or the copy's temp dir; the copy itself shows up as commits
const MUTATING = /^(pnpm (install|migrate|seed:|build|exec next)|git (commit|init))/

function snapshot(w: World, db: Db) {
  const commits = (dir: string) => (existsSync(join(dir, '.git')) ? git(dir, 'log', '--all', '--format=%H %(trailers:key=Create-Website-Step,valueonly,separator=%x2C)').trim() : '')
  const p = w.ctx.paths
  return {
    commits: { record: commits(p.record), backend: commits(p.backend), site: commits(p.site) },
    files: Object.fromEntries(
      [
        [p.backend, '.env'],
        [p.backend, '.admin-credentials.local'],
        [p.site, '.env.local'],
        [p.record, 'provisioning-request.json'],
        [p.record, 'provisioning.json'],
        [p.record, 'starter-copy.json'],
        [p.record, 'outward-plan.md'],
        [p.record, 'outward-plan.json'],
        [p.backend, 'README.md'],
      ].map(([d, f]) => [`${d === p.record ? 'record' : d === p.backend ? 'backend' : 'site'}/${f}`, sha(join(d!, f!))]),
    ),
    dbsCreated: [...w.pg.created],
    started: w.procs.started.length,
    mutating: w.exec.calls.filter((c) => MUTATING.test(c.argv.join(' '))).length,
    db: { users: [...db.users.keys()].sort(), tenants: [...db.tenants.entries()], siteKey: db.siteKey, migrations: [...db.migrations] },
    tenantId: w.state.get().tenantId,
    siteKeyMintedAt: w.state.get().siteKey?.mintedAt,
  }
}

const STARTER_MODULE = `
export const starterCopySchema = { safeParse: (v) => ({ success: true, data: v }) }
export function defaultStarterCopy(tone) { return { copyVersion: 1, tone, hero: { headline: 'Vítejte u {brand}' } } }
`

let w: World
let db: Db
const results: Array<{ id: StepId; first: ReturnType<typeof snapshot>; second: ReturnType<typeof snapshot> }> = []

beforeAll(async () => {
  w = makeWorld()
  db = { migrations: new Set(), users: new Map(), tenants: new Map(), settings: new Set(), siteKey: null }
  // templates: a cms repo with the M1 starter-copy module and one migration; a platform repo with its manifests
  const cms = w.ctx.cfg.cmsRepo
  mkdirSync(join(cms, 'src', 'migrations'), { recursive: true })
  mkdirSync(join(cms, 'src', 'seed'), { recursive: true })
  writeFileSync(join(cms, 'src', 'seed', 'starterCopy.ts'), STARTER_MODULE)
  writeFileSync(join(cms, 'src', 'migrations', 'index.ts'), 'export const migrations = []\n')
  writeFileSync(join(cms, 'src', 'migrations', '20261108_100819_baseline.ts'), 'export {}\n')
  makeCmsRepo(cms)
  const plat = w.ctx.cfg.platformRepo
  mkdirSync(join(plat, 'apps', 'site'), { recursive: true })
  mkdirSync(join(plat, 'packages', 'theme-realvista'), { recursive: true })
  writeFileSync(join(plat, 'apps', 'site', 'realvista-template.json'), '{"template":"realvista-site","templateApiVersion":1}')
  writeFileSync(join(plat, 'packages', 'theme-realvista', 'package.json'), '{"version":"0.1.0"}')
  git(plat, 'init', '-q', '-b', 'main')
  git(plat, 'add', '-A')
  git(plat, 'commit', '-q', '-m', 'platform')
  installFakes(w, db)

  // Every local step, in runbook order: run, snapshot, run again, snapshot.
  for (const step of STEPS) {
    if (step.outward) continue
    if (step.skipReason?.(w.ctx)) continue
    const fp = step.fingerprint(w.ctx)
    const outputs = await step.run(w.ctx)
    // what the runner records after a success
    w.state.patchStep(step.id, { status: 'done', fingerprint: fp, outputs })
    const first = snapshot(w, db)
    // the crash case: state never learned the step finished
    w.state.patchStep(step.id, { status: 'running' })
    await step.run(w.ctx)
    w.state.patchStep(step.id, { status: 'done' })
    results.push({ id: step.id, first, second: snapshot(w, db) })
  }
}, 120_000)

afterAll(() => w?.cleanup())

describe('run() twice = one side effect, for every local step', () => {
  it('covers every non-outward step except the ones skipped for file input', () => {
    const expected = STEPS.filter((s) => !s.outward && s.id !== 'crm-site-record').map((s) => s.id)
    expect(results.map((r) => r.id)).toEqual(expected)
  })

  it.each(STEPS.filter((s) => !s.outward && s.id !== 'crm-site-record').map((s) => [s.id]))('%s', (id) => {
    const r = results.find((x) => x.id === id)!
    expect(r.second).toEqual(r.first)
  })

  it('the world after the full pass is the one-run world', () => {
    const last = results[results.length - 1]!.second
    expect(last.dbsCreated).toEqual(['cw6_backend_svoboda_reality_dev'])
    expect(last.started).toBe(2)
    expect(last.db.tenants).toHaveLength(1)
    expect(last.db.users).toHaveLength(2)
    expect(w.exec.ran((a) => a.join(' ') === 'pnpm seed:site-key')).toHaveLength(1)
    for (const repo of ['record', 'backend', 'site'] as const) {
      const steps = last.commits[repo].split('\n').map((l) => l.split(' ')[1]).filter(Boolean)
      expect(new Set(steps).size, `${repo}: one commit per step trailer`).toBe(steps.length)
    }
  })
})
