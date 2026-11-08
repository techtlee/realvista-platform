/**
 * Real failure-injection matrix (design §B "Failure injection", 5 points),
 * chained on ONE provisioning so the suite costs about one full run:
 *
 *   A. CW_CRASH_AT=backend-copy:mid          → exit 137
 *   B. resume + CW_FAIL_AT=backend-credentials:after  → exit 5
 *   C. resume + CW_FAIL_AT=site-key:after             → exit 5
 *   D. resume + CW_FAIL_AT=site-build:before          → exit 5
 *   then a plain resume → complete
 *   E. second slug: CW_FAIL_AT=site-key:before → exit 5 (backend up), kill -9 the
 *      backend, resume → complete
 *
 * After every resume: same runId, same ports, credentials file sha and
 * PAYLOAD_SECRET unchanged once they exist, no duplicate trailer commits,
 * tenant/users/DB count 1, the site key minted once (except E, where the probe
 * may still succeed after the restart, so mintedAt may stay or change once).
 *
 * Ports: site 4177–4181, backend 4277–4281. DBs cwtest_<rand>_*.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FIXTURES, cw, databases, destroyRoot, duplicateTrailers, e2eEnabled, envKeyHash, explain, fileSha, incompleteSteps,
  makeRoot, sh, state, tenantsAndUsers, type Root,
} from './helpers.js'

const SLUG = 'svoboda-reality'
const REQ = join(FIXTURES, 'svoboda-friendly-indigo.request.json')
const hook = (k: 'CW_FAIL_AT' | 'CW_CRASH_AT', v: string) => ({ CW_TEST_HOOKS: '1', [k]: v })

describe.skipIf(!e2eEnabled)('failure matrix on a real provisioning', () => {
  let root: Root
  let runId: string | undefined
  let ports: any
  let credsSha: string | null = null
  let secretHash: string | null = null
  let mintedAt: string | undefined
  const rec = () => join(root.clients, SLUG)
  const backend = () => join(root.clients, `backend-${SLUG}`)
  const site = () => join(root.clients, `site-${SLUG}`)

  beforeAll(() => {
    root = makeRoot({ site: [4177, 4181], backend: [4277, 4281] })
  })
  afterAll(async () => {
    await destroyRoot(root)
  })

  /** Invariants after every resume. */
  function invariants(label: string) {
    const st = state(root, SLUG)
    runId ??= st.runId
    ports ??= st.ports
    expect(st.runId, `${label}: runId`).toBe(runId)
    expect(st.ports, `${label}: ports`).toEqual(ports)
    const c = fileSha(join(backend(), '.admin-credentials.local'))
    if (credsSha) expect(c, `${label}: credentials file`).toBe(credsSha)
    else credsSha = c
    const s = envKeyHash(join(backend(), '.env'), 'PAYLOAD_SECRET')
    if (secretHash) expect(s, `${label}: PAYLOAD_SECRET`).toBe(secretHash)
    else secretHash = s
    if (st.siteKey?.mintedAt) {
      if (mintedAt) expect(st.siteKey.mintedAt, `${label}: site key minted once`).toBe(mintedAt)
      else mintedAt = st.siteKey.mintedAt
    }
    for (const d of [rec(), backend(), site()]) if (existsSync(join(d, '.git'))) expect(duplicateTrailers(d), `${label}: ${d}`).toEqual([])
    const dbs = databases(root)
    expect(dbs.length, `${label}: DBs ${dbs.join(',')}`).toBeLessThanOrEqual(1)
    if (st.tenantId && dbs.length) {
      const { tenants, users } = tenantsAndUsers(dbs[0]!)
      expect(tenants, `${label}: tenants`).toEqual([SLUG])
      expect(users.filter((u) => u.email.startsWith(`site+${SLUG}@`)).length, `${label}: key users`).toBeLessThanOrEqual(1)
      expect(users.filter((u) => u.role === 'client' && !u.email.startsWith('site+')).length, `${label}: realtors`).toBeLessThanOrEqual(1)
    }
    expect(sh('ls', ['-a', root.clients]).stdout, `${label}: no .cw-tmp leftovers`).not.toMatch(/\.cw-tmp-/)
    return st
  }

  // Each resume carries the next injection, so A→B→C→D is one provisioning.
  it('A: crash in the middle of backend-copy (exit 137)', () => {
    const r = cw(root, ['run', '--request', REQ], hook('CW_CRASH_AT', 'backend-copy:mid'))
    expect(r.code, explain(r)).toBe(137)
    const crashed = state(root, SLUG)
    expect(crashed.steps['backend-copy'].status).toBe('running') // what a crash leaves on disk
    expect(crashed.steps['record-repo'].status).toBe('done')
  })

  it('B: resume of A completes backend-copy; then fail right after backend-credentials', () => {
    const r = cw(root, ['run', '--request', REQ], hook('CW_FAIL_AT', 'backend-credentials:after'))
    expect(r.code, explain(r)).toBe(5)
    expect(r.json?.step).toBe('backend-credentials')
    const st = invariants('B')
    expect(st.steps['backend-copy'].status).toBe('done')
    expect(st.steps['record-repo'].attempts).toBe(1)
    expect(credsSha, 'credentials written before the injected failure').toBeTruthy()
  })

  it('C: resume of B keeps the credentials; then fail right after site-key', () => {
    const r = cw(root, ['run', '--request', REQ], hook('CW_FAIL_AT', 'site-key:after'))
    expect(r.code, explain(r)).toBe(5)
    expect(r.json?.step).toBe('site-key')
    const st = invariants('C')
    expect(st.steps['backend-credentials'].status).toBe('done')
    for (const id of ['record-repo', 'backend-db', 'backend-customize']) expect(st.steps[id].attempts, id).toBe(1)
    expect(mintedAt, 'site-key minted before the injected failure').toBeTruthy()
  })

  it('D: resume of C does not re-mint the key; then fail before site-build', () => {
    const r = cw(root, ['run', '--request', REQ], hook('CW_FAIL_AT', 'site-build:before'))
    expect(r.code, explain(r)).toBe(5)
    expect(r.json?.step).toBe('site-build')
    invariants('D')
    const status = cw(root, ['status', SLUG])
    expect(status.code, explain(status)).toBe(0)
    expect(JSON.stringify(status.json)).toMatch(/site-build/)
  })

  it('resume of D completes with every invariant intact', () => {
    const resumed = cw(root, ['run', '--request', REQ])
    expect(resumed.code, explain(resumed)).toBe(0)
    const st = invariants('final')
    expect(incompleteSteps(st, ['crm-site-record', 'crm-report'])).toEqual([])
    expect(st.steps['backend-credentials'].attempts).toBeLessThanOrEqual(2) // B re-ran run() once: ensure(), never regenerate
    expect(st.steps['site-copy'].attempts).toBe(1)
    expect(st.steps['backend-db'].attempts).toBe(1)
    expect(st.verify.filter((c: any) => !c.ok)).toEqual([])
  })

  it('E: kill -9 the backend between backend-start and site-key, resume', () => {
    const SLUG2 = 'horak-reality'
    const REQ2 = join(FIXTURES, 'horak.request.json')
    const r = cw(root, ['run', '--request', REQ2], hook('CW_FAIL_AT', 'site-key:before'))
    expect(r.code, explain(r)).toBe(5)
    const st0 = state(root, SLUG2)
    const pid = st0.processes.backend?.pid
    expect(pid, 'backend-start recorded a pid').toBeTruthy()
    sh('kill', ['-9', String(pid)])
    // next dev forks; also kill whatever still holds the port
    for (const p of sh('lsof', ['-nP', `-iTCP:${st0.ports.backend}`, '-sTCP:LISTEN', '-t']).stdout.split('\n').filter(Boolean)) sh('kill', ['-9', p])
    const creds = fileSha(join(root.clients, `backend-${SLUG2}`, '.admin-credentials.local'))
    const resumed = cw(root, ['run', '--request', REQ2])
    expect(resumed.code, explain(resumed)).toBe(0)
    const st = state(root, SLUG2)
    expect(st.runId).toBe(st0.runId)
    expect(st.ports).toEqual(st0.ports)
    expect(st.processes.backend.pid).not.toBe(pid)
    expect(fileSha(join(root.clients, `backend-${SLUG2}`, '.admin-credentials.local'))).toBe(creds)
    expect(incompleteSteps(st, ['crm-site-record', 'crm-report'])).toEqual([])
    const db = st.db.name
    const { tenants, users } = tenantsAndUsers(db)
    expect(tenants).toEqual([SLUG2])
    expect(users.filter((u) => u.email.startsWith(`site+${SLUG2}@`))).toHaveLength(1)
  })
})
