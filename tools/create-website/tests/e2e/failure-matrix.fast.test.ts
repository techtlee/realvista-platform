/**
 * Fast failure matrix (design §B "Failure injection — fast matrix"): the REAL
 * CLI, runner, state file, lock and test hooks, over a fake world
 * (fake-world/steps.ts via CW_STEPS_MODULE). No Postgres, no network, no ports.
 *
 * For every local step × {before, after, mid where supported}:
 *   cw run with the hook → exit 5 (137 for mid) → cw run → exit 0, and
 *   - every step before the failure point ran run() exactly once (always-re-run steps excepted)
 *   - the failing step ran at most twice (once for `before`), with one recover() for `mid`
 *   - every step after it ran once; outward steps never ran, all are `planned`
 *   - the runId is the same; the credentials were written once
 * Plus: stale fingerprints (downstream re-run, STALE_IRREVERSIBLE for
 * credentials), a foreign partial artefact (conflict, exit 3), and the lock
 * (live → exit 6, dead pid → taken over).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hostname } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { OUTWARD_STEP_IDS, STEP_IDS, type StepId } from '../../src/types.js'
import { ALWAYS, MID } from './fake-world/steps.js'
import { FIXTURES, TOOL_DIR, cw, destroyRoot, explain, makeRoot, state, type Root } from './helpers.js'

const SLUG = 'svoboda-reality'
const REQ = join(FIXTURES, 'svoboda-friendly-indigo.request.json')
const STEPS_MODULE = resolve(TOOL_DIR, 'tests', 'e2e', 'fake-world', 'steps.ts')
const LOCAL = STEP_IDS.filter((s) => !(OUTWARD_STEP_IDS as readonly string[]).includes(s) && s !== 'crm-site-record') as StepId[]

const roots: Root[] = []
afterAll(async () => {
  for (const r of roots) await destroyRoot(r)
})

function fakeRoot() {
  const root = makeRoot({ site: [4182, 4183], backend: [4282, 4283] })
  roots.push(root)
  const worldDir = join(root.dir, 'world')
  mkdirSync(worldDir, { recursive: true })
  const env = (extra: Record<string, string> = {}) => ({ CW_STEPS_MODULE: STEPS_MODULE, CW_FAKE_WORLD: worldDir, ...extra })
  const calls = () => (existsSync(join(worldDir, 'calls.log')) ? readFileSync(join(worldDir, 'calls.log'), 'utf8').split('\n').filter(Boolean) : [])
  const runs = (id: StepId) => calls().filter((l) => l.startsWith(`run ${id} `)).length
  const recovers = (id: StepId) => calls().filter((l) => l.startsWith(`recover ${id} `)).length
  return { root, worldDir, env, calls, runs, recovers }
}

type When = 'before' | 'after' | 'mid'
const scenarios: [StepId, When][] = LOCAL.flatMap((id) => [[id, 'before'], [id, 'after'], ...(MID.has(id) ? [[id, 'mid']] : [])] as [StepId, When][])

describe('fast failure matrix (real CLI, fake world)', () => {
  it.each(scenarios)('%s:%s → resume completes without redoing earlier work', (id, when) => {
    const w = fakeRoot()
    const hookEnv: Record<string, string> = when === 'mid' ? { CW_TEST_HOOKS: '1', CW_CRASH_AT: `${id}:mid` } : { CW_TEST_HOOKS: '1', CW_FAIL_AT: `${id}:${when}` }
    const first = cw(w.root, ['run', '--request', REQ], w.env(hookEnv), 120_000)
    expect(first.code, explain(first)).toBe(when === 'mid' ? 137 : 5)
    const runId = state(w.root, SLUG).runId
    const creds1 = existsSync(join(w.worldDir, 'credentials')) ? readFileSync(join(w.worldDir, 'credentials'), 'utf8') : null

    const second = cw(w.root, ['run', '--request', REQ], w.env(), 120_000)
    expect(second.code, explain(second)).toBe(0)
    const st = state(w.root, SLUG)
    expect(st.runId).toBe(runId)

    const idx = STEP_IDS.indexOf(id)
    for (const s of LOCAL) {
      if (ALWAYS.has(s)) continue
      const n = w.runs(s)
      const i = STEP_IDS.indexOf(s)
      if (i < idx) expect(n, `${s} (before ${id}) re-ran`).toBe(1)
      else if (i > idx) expect(n, `${s} (after ${id})`).toBe(1)
      else expect(n, `${s} itself`).toBe(when === 'before' ? 1 : 2)
    }
    if (when === 'mid') expect(w.recovers(id), `recover(${id})`).toBe(1)
    for (const o of OUTWARD_STEP_IDS) {
      expect(w.runs(o as StepId), `outward ${o} run()`).toBe(0)
      expect(st.steps[o].status, o).toBe('planned')
    }
    for (const s of LOCAL) expect(st.steps[s].status, s).toBe('done')
    expect(st.steps['crm-site-record'].status).toBe('skipped')
    if (creds1) expect(readFileSync(join(w.worldDir, 'credentials'), 'utf8')).toBe(creds1)
  })

  it('a changed fingerprint re-runs that step and its dependents only', () => {
    const w = fakeRoot()
    expect(cw(w.root, ['run', '--request', REQ], w.env(), 120_000).code).toBe(0)
    const r = cw(w.root, ['run', '--request', REQ], w.env({ CW_FAKE_FP_SITE_COPY: 'v2' }), 120_000)
    expect(r.code, explain(r)).toBe(0)
    const idx = STEP_IDS.indexOf('site-copy')
    for (const s of LOCAL) {
      if (ALWAYS.has(s)) continue
      const want = STEP_IDS.indexOf(s) >= idx ? 2 : 1
      expect(w.runs(s), s).toBe(want)
    }
  })

  it('a changed credentials fingerprint stops with STALE_IRREVERSIBLE (exit 3), credentials untouched', () => {
    const w = fakeRoot()
    expect(cw(w.root, ['run', '--request', REQ], w.env(), 120_000).code).toBe(0)
    const creds = readFileSync(join(w.worldDir, 'credentials'), 'utf8')
    const r = cw(w.root, ['run', '--request', REQ], w.env({ CW_FAKE_FP_BACKEND_CREDENTIALS: 'v2' }), 120_000)
    expect(r.code, explain(r)).toBe(3)
    expect(r.json?.code).toBe('STALE_IRREVERSIBLE')
    expect(r.json?.step).toBe('backend-credentials')
    expect(w.runs('backend-credentials')).toBe(1)
    expect(readFileSync(join(w.worldDir, 'credentials'), 'utf8')).toBe(creds)
  })

  it('a half-written artefact from another run is a conflict (exit 3), not recovered', () => {
    const w = fakeRoot()
    writeFileSync(join(w.worldDir, 'backend-copy.partial'), 'cw-20200101T000000Z-dead')
    const r = cw(w.root, ['run', '--request', REQ], w.env(), 120_000)
    expect(r.code, explain(r)).toBe(3)
    expect(w.recovers('backend-copy')).toBe(0)
    expect(existsSync(join(w.worldDir, 'backend-copy.partial'))).toBe(true)
  })

  it('a live lock refuses (exit 6); a dead pid lock is taken over', () => {
    const w = fakeRoot()
    expect(cw(w.root, ['run', '--request', REQ], w.env(), 120_000).code).toBe(0)
    const lock = join(w.root.clients, SLUG, '.create-website.lock')
    const runId = state(w.root, SLUG).runId
    writeFileSync(lock, JSON.stringify({ pid: process.pid, runId, host: hostname(), startedAt: new Date().toISOString() }))
    const live = cw(w.root, ['run', '--request', REQ], w.env(), 120_000)
    expect(live.code, explain(live)).toBe(6)
    writeFileSync(lock, JSON.stringify({ pid: 999_999, runId, host: hostname(), startedAt: new Date().toISOString() }))
    const dead = cw(w.root, ['run', '--request', REQ], w.env(), 120_000)
    expect(dead.code, explain(dead)).toBe(0)
  })

  it('test hooks are refused without a testMode config', () => {
    const w = fakeRoot()
    const cfgPath = join(w.root.dir, 'create-website.config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, testMode: false }))
    const r = cw(w.root, ['run', '--request', REQ], { CW_TEST_HOOKS: '1', CW_FAIL_AT: 'input:before' }, 120_000)
    expect(r.code, explain(r)).toBe(4)
    expect(r.json?.code).toBe('TEST_HOOKS_REFUSED')
    expect(existsSync(join(w.root.clients, SLUG))).toBe(false)
  })
})
