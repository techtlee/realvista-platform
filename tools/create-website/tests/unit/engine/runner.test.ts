import { describe, expect, it } from 'vitest'

import { dependentsOf, nextStep, runSteps, topoSort } from '../../../src/runner.js'
import { MemoryStateStore } from '../../../src/state/store.js'
import { createTestHooks } from '../../../src/testHooks.js'
import { OUTWARD_STEP_IDS, STEP_IDS, type Config, type StepId } from '../../../src/types.js'
import { baseState, fakeCtx, fakeWorld } from '../../helpers/fakeWorld.js'

const LOCAL = STEP_IDS.filter((id) => !(OUTWARD_STEP_IDS as readonly string[]).includes(id))

describe('runner: fresh run over all steps', () => {
  it('runs every local step once, plans every outward step, never run()s an outward one', async () => {
    const { steps, ctl } = fakeWorld()
    const ctx = fakeCtx()
    const r = await runSteps(steps, ctx)
    expect(r.ok).toBe(true)
    expect(r.exitCode).toBe(0)
    for (const id of LOCAL) {
      expect(ctl[id].runs, id).toBe(1)
      expect(ctx.state.step(id).status).toBe('done')
      expect(ctx.state.step(id).fingerprint).toBe(`fp-${id}`)
    }
    for (const id of OUTWARD_STEP_IDS) {
      expect(ctl[id].runs, id).toBe(0)
      expect(ctl[id].plans, id).toBe(1)
      expect(ctx.state.step(id).status).toBe('planned')
    }
    expect(r.ran).toEqual(LOCAL)
    expect(nextStep(steps, ctx)).toBeNull()
  })

  it('second run skips everything (done + same fingerprint + probe done)', async () => {
    const { steps, ctl } = fakeWorld()
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    const r = await runSteps(steps, ctx)
    expect(r.ran).toEqual([])
    for (const id of LOCAL) expect(ctl[id].runs).toBe(1)
    expect(Object.values(r.outcomes).filter((x) => x === 'skipped-done')).toHaveLength(LOCAL.length)
  })
})

describe('runner rule, per step (table over all local steps)', () => {
  it.each(LOCAL.map((id) => [id]))('%s: conflict stops with exit 3 and nothing after it runs', async (id) => {
    const { steps, ctl } = fakeWorld()
    ctl[id as StepId].probe = { state: 'conflict', code: 'TARGET_EXISTS', detail: 'in the way' }
    const ctx = fakeCtx()
    const r = await runSteps(steps, ctx)
    expect(r.exitCode).toBe(3)
    expect(r.failed?.step).toBe(id)
    expect(r.failed?.code).toBe('TARGET_EXISTS')
    expect(ctl[id as StepId].runs).toBe(0)
    const after = STEP_IDS.slice(STEP_IDS.indexOf(id as StepId) + 1)
    for (const a of after) expect(ctl[a].runs + ctl[a].plans).toBe(0)
    expect(ctx.state.step(id as StepId).status).toBe('failed')
  })

  it.each(LOCAL.map((id) => [id]))('%s: partial → recover then run', async (id) => {
    const { steps, ctl } = fakeWorld()
    ctl[id as StepId].probe = { state: 'partial', detail: 'half' }
    const r = await runSteps(steps, fakeCtx())
    expect(r.ok).toBe(true)
    expect(ctl[id as StepId].recovers).toBe(1)
    expect(ctl[id as StepId].runs).toBe(1)
  })

  it.each(LOCAL.map((id) => [id]))('%s: failure → exit 5; resume re-runs only from the failed step', async (id) => {
    const { steps, ctl } = fakeWorld()
    ctl[id as StepId].throwOnRun = new Error('boom')
    const ctx = fakeCtx()
    const r1 = await runSteps(steps, ctx)
    expect(r1.exitCode).toBe(5)
    expect(ctx.state.step(id as StepId).error?.message).toBe('boom')
    delete ctl[id as StepId].throwOnRun
    const r2 = await runSteps(steps, ctx)
    expect(r2.ok).toBe(true)
    const idx = LOCAL.indexOf(id as StepId)
    for (const before of LOCAL.slice(0, idx)) expect(ctl[before].runs, before).toBe(1)
    expect(ctl[id as StepId].runs).toBe(2)
    expect(ctx.state.step(id as StepId).attempts).toBe(2)
  })
})

describe('runner: done but world disagrees', () => {
  it('done + probe absent → run again (e.g. a dead backend)', async () => {
    const { steps, ctl } = fakeWorld()
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    ctl['backend-start'].probe = { state: 'absent' }
    const r = await runSteps(steps, ctx)
    expect(r.ran).toEqual(['backend-start'])
  })
})

describe('runner: staleness', () => {
  it('a changed fingerprint re-runs the step and every dependent', async () => {
    const { steps, ctl } = fakeWorld()
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    ctl['site-key'].fp = 'fp-site-key-v2'
    const r = await runSteps(steps, ctx)
    const from = LOCAL.indexOf('site-key')
    expect(r.ran).toEqual(LOCAL.slice(from))
    for (const id of LOCAL.slice(0, from)) expect(ctl[id].runs).toBe(1)
  })

  it('an irreversible step with a changed fingerprint stops with STALE_IRREVERSIBLE (exit 3)', async () => {
    const { steps, ctl } = fakeWorld({ irreversible: ['backend-credentials'] })
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    ctl['backend-credentials'].fp = 'changed'
    const r = await runSteps(steps, ctx)
    expect(r.exitCode).toBe(3)
    expect(r.failed?.code).toBe('STALE_IRREVERSIBLE')
    expect(ctl['backend-credentials'].runs).toBe(1)
  })

  it('an irreversible step made stale only by an upstream change is re-probed: done → kept, not re-run', async () => {
    const { steps, ctl } = fakeWorld({ irreversible: ['backend-credentials'] })
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    ctl['backend-db'].fp = 'changed'
    const r = await runSteps(steps, ctx)
    expect(r.ok).toBe(true)
    expect(r.outcomes['backend-credentials']).toBe('skipped-done')
    expect(ctl['backend-credentials'].runs).toBe(1)
    expect(ctx.state.step('backend-credentials').stale).toBe(false)
    expect(r.ran).toContain('backend-db')
    expect(r.ran).not.toContain('backend-credentials')
  })

  it('inherited staleness with an incomplete world runs the irreversible step (gap-filling), no STALE_IRREVERSIBLE', async () => {
    const { steps, ctl } = fakeWorld({ irreversible: ['backend-credentials'] })
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    ctl['backend-db'].fp = 'changed'
    ctl['backend-credentials'].probe = { state: 'partial', detail: 'a key is missing' }
    const r = await runSteps(steps, ctx)
    expect(r.ok).toBe(true)
    expect(ctl['backend-credentials'].runs).toBe(2)
  })

  it('a persisted stale flag from an older run is re-probed the same way', async () => {
    const { steps, ctl } = fakeWorld({ irreversible: ['backend-credentials'] })
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    ctx.state.patchStep('backend-credentials', { stale: true })
    const r = await runSteps(steps, ctx)
    expect(r.ok).toBe(true)
    expect(ctl['backend-credentials'].runs).toBe(1)
    expect(ctx.state.step('backend-credentials').stale).toBe(false)
  })

  it('staleness is persisted, so a run that dies before reaching a dependent still re-runs it', async () => {
    const { steps, ctl } = fakeWorld()
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    ctl['site-copy'].fp = 'v2'
    ctl['site-env'].throwOnRun = new Error('die')
    await runSteps(steps, ctx)
    expect(ctx.state.step('site-build').stale).toBe(true)
    delete ctl['site-env'].throwOnRun
    const r = await runSteps(steps, ctx)
    expect(r.ran).toContain('site-build')
    expect(ctx.state.step('site-build').stale).toBe(false)
  })
})

describe('runner: skip, only, hooks, CRM outbox', () => {
  it('skipReason marks the step skipped without probing or running', async () => {
    const { steps, ctl } = fakeWorld({ skip: { 'crm-site-record': 'file input: no CRM site to check' } })
    const ctx = fakeCtx()
    await runSteps(steps, ctx)
    expect(ctx.state.step('crm-site-record')).toMatchObject({ status: 'skipped', note: 'file input: no CRM site to check' })
    expect(ctl['crm-site-record'].runs).toBe(0)
  })

  it('only: runs just the named steps', async () => {
    const { steps, ctl } = fakeWorld()
    const r = await runSteps(steps, fakeCtx(), { only: ['verify'] })
    expect(r.ran).toEqual(['verify'])
    expect(ctl.preflight.runs).toBe(0)
  })

  it('CW_FAIL_AT before/after: the failed step re-runs on resume, earlier ones never', async () => {
    const cfg = { testMode: true, clientsDir: '/tmp/cw-e2e-x/clients', configPath: '/tmp/x.json' } as Config
    for (const when of ['before', 'after'] as const) {
      const { steps, ctl } = fakeWorld()
      const ctx = fakeCtx(new MemoryStateStore(baseState()), createTestHooks(cfg, { env: { CW_TEST_HOOKS: '1', CW_FAIL_AT: `site-build:${when}` } }))
      const r1 = await runSteps(steps, ctx)
      expect(r1.exitCode).toBe(5)
      expect(ctl['site-build'].runs).toBe(when === 'before' ? 0 : 1)
      delete ctx.testHooks
      const r2 = await runSteps(steps, ctx)
      expect(r2.ok).toBe(true)
      for (const id of LOCAL.slice(0, LOCAL.indexOf('site-build'))) expect(ctl[id].runs).toBe(1)
      expect(ctx.state.step('backend-credentials').attempts).toBe(1)
    }
  })

  it('queues coarse CRM entries once per key: ok when a group completes, failed on failure, skipped for outward', async () => {
    const { steps, ctl } = fakeWorld()
    const ctx = fakeCtx()
    ctl['site-build'].throwOnRun = new Error('next build exited 1')
    await runSteps(steps, ctx)
    delete ctl['site-build'].throwOnRun
    await runSteps(steps, ctx)
    await runSteps(steps, ctx)
    const keys = ctx.state.get().crmOutbox.map((e) => e.key.split(':').slice(1).join(':'))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(
      expect.arrayContaining([
        'provisioning-json:ok',
        'backend-repo-local:ok',
        'backend-seed:ok',
        'site-repo-local:failed',
        'site-repo-local:ok',
        'verify:ok',
        'github-repos:skipped',
        'fallback-dns:skipped',
      ]),
    )
  })
})

describe('graph helpers', () => {
  it('topoSort rejects unknown deps and cycles, orders by STEP_IDS', () => {
    const { steps } = fakeWorld()
    expect(topoSort([...steps].reverse()).map((s) => s.id)).toEqual([...STEP_IDS])
    expect(() => topoSort([{ ...steps[1]!, dependsOn: ['handover'] }])).toThrow(/unknown/)
    const a = { ...steps[0]!, dependsOn: ['input' as StepId] }
    const b = { ...steps[1]!, dependsOn: ['preflight' as StepId] }
    expect(() => topoSort([a, b])).toThrow(/cycle/)
  })
  it('dependentsOf is transitive', () => {
    const { steps } = fakeWorld()
    expect(dependentsOf(steps, 'go-live')).toEqual(new Set(['outward-plan', 'handover']))
  })
})
