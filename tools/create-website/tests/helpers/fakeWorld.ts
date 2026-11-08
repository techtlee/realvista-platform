/**
 * A fake world for runner/engine tests: one fake step per STEP_ID (linear
 * chain), with per-step probe results, fingerprints and call counters.
 */
import { MemoryRunLogger } from '../../src/log.js'
import { MemoryStateStore } from '../../src/state/store.js'
import {
  OUTWARD_STEP_IDS,
  STEP_IDS,
  TOOL_VERSION,
  type Ctx,
  type CwState,
  type Probe,
  type Step,
  type StepId,
  type StateStore,
  type TestHooks,
} from '../../src/types.js'

export interface FakeStepControl {
  probe: Probe
  fp: string
  runs: number
  recovers: number
  plans: number
  /** world effect of run(): probe becomes done afterwards (default true) */
  runMakesDone: boolean
  throwOnRun?: Error
}

export function baseState(over: Partial<CwState> = {}): CwState {
  return {
    stateVersion: 1,
    toolVersion: TOOL_VERSION,
    runId: 'cw-20261108T120301Z-7f3a',
    slug: 'svoboda-reality',
    mode: 'local',
    createdAt: '2026-11-08T12:03:01.000Z',
    updatedAt: '2026-11-08T12:03:01.000Z',
    input: { source: 'file', requestSha256: 'r', provisioningSha256: 'p' },
    templates: {},
    paths: { record: '/x/clients/svoboda-reality', backend: '/x/clients/backend-svoboda-reality', site: '/x/clients/site-svoboda-reality' },
    ports: { site: 3111, backend: 3211 },
    secrets: {},
    steps: {},
    processes: { backend: null, site: null },
    verify: [],
    crmOutbox: [],
    ...over,
  }
}

export function fakeWorld(o: { irreversible?: StepId[]; skip?: Partial<Record<StepId, string>> } = {}) {
  const ctl = Object.fromEntries(
    STEP_IDS.map((id) => [id, { probe: { state: 'absent' }, fp: `fp-${id}`, runs: 0, recovers: 0, plans: 0, runMakesDone: true } as FakeStepControl]),
  ) as Record<StepId, FakeStepControl>
  const outward = new Set<string>(OUTWARD_STEP_IDS)
  const steps: Step[] = STEP_IDS.map((id, i) => {
    const c = ctl[id]
    const s: Step = {
      id,
      runbook: String(i + 1),
      phase: 'B',
      outward: outward.has(id),
      dependsOn: i === 0 ? [] : [STEP_IDS[i - 1]!],
      ...(o.irreversible?.includes(id) ? { irreversible: true } : {}),
      ...(o.skip?.[id] ? { skipReason: () => o.skip![id]! } : {}),
      fingerprint: () => c.fp,
      probe: async () => c.probe,
      recover: async () => {
        c.recovers++
      },
      run: async () => {
        if (outward.has(id)) throw new Error(`outward step ${id} must never run in local mode`)
        c.runs++
        if (c.throwOnRun) throw c.throwOnRun
        if (c.runMakesDone) c.probe = { state: 'done' }
        return { ran: c.runs }
      },
      plan: () => {
        c.plans++
        return [{ id: `${id}-1`, description: id, argv: ['echo', id], envNames: [] }]
      },
    }
    return s
  })
  return { steps, ctl }
}

export function fakeCtx(state: StateStore = new MemoryStateStore(baseState()), testHooks?: TestHooks): Ctx {
  const never = new Proxy({}, { get: () => () => { throw new Error('not available in the fake world') } })
  return {
    cfg: {} as Ctx['cfg'],
    state,
    exec: never as Ctx['exec'],
    secrets: never as Ctx['secrets'],
    pg: never as Ctx['pg'],
    procs: never as Ctx['procs'],
    http: never as Ctx['http'],
    log: new MemoryRunLogger('/tmp/cw-fake-logs'),
    request: {} as Ctx['request'],
    paths: state.get().paths,
    ...(testHooks ? { testHooks } : {}),
  }
}
