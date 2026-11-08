/**
 * The runner (A2 "Runner rule"). Steps run in topological order; for each:
 *
 * - outward step (local mode): never run(); plan() only, status `planned`,
 *   CRM entry `skipped`.
 * - skipReason(ctx) → status `skipped`.
 * - stale (own fingerprint changed, or an upstream step's did): re-run,
 *   except `irreversible` steps, which stop with STALE_IRREVERSIBLE (exit 3).
 * - state `done`, fingerprint unchanged and probe() `done` → skip.
 * - probe() `conflict` → stop, exit 3.
 * - probe() `partial` → recover() (only this runId's leftovers), then run().
 * - otherwise run().
 *
 * The runner never calls process.exit; it returns a report the CLI maps to
 * an exit code. The CRM outbox is filled here; flushing is crm-report's and
 * the CLI's business.
 */
import { enqueue } from './crm/outbox.js'
import {
  CRM_LOG_NAMES,
  CwError,
  EXIT,
  STEP_IDS,
  type Ctx,
  type ExitCode,
  type Probe,
  type Step,
  type StepError,
  type StepId,
} from './types.js'

export type StepOutcome = 'ran' | 'skipped-done' | 'skipped' | 'planned' | 'failed' | 'conflict' | 'not-reached' | 'excluded'

export interface RunReport {
  ok: boolean
  exitCode: ExitCode
  outcomes: Partial<Record<StepId, StepOutcome>>
  ran: StepId[]
  failed?: { step: StepId; code: string; message: string; hint?: string }
}

export interface RunOptions {
  /** run only these steps (others are left untouched); default all */
  only?: StepId[]
  /** stop after this step */
  until?: StepId
  now?: () => Date
}

export function crmNameOf(step: Step): string | undefined {
  return step.crmLogName ?? (CRM_LOG_NAMES as Partial<Record<StepId, string>>)[step.id]
}

/** Topological order, ties broken by STEP_IDS order. Throws on unknown deps or cycles. */
export function topoSort(steps: Step[]): Step[] {
  const byId = new Map(steps.map((s) => [s.id, s]))
  if (byId.size !== steps.length) throw new Error('duplicate step ids in the registry')
  for (const s of steps) for (const d of s.dependsOn) if (!byId.has(d)) throw new Error(`step ${s.id} depends on unknown step ${d}`)
  const rank = (id: StepId) => STEP_IDS.indexOf(id)
  const indeg = new Map(steps.map((s) => [s.id, s.dependsOn.length]))
  const out: Step[] = []
  const ready = steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id)
  while (ready.length) {
    ready.sort((a, b) => rank(a) - rank(b))
    const id = ready.shift()!
    out.push(byId.get(id)!)
    for (const s of steps) {
      if (s.dependsOn.includes(id)) {
        const n = indeg.get(s.id)! - 1
        indeg.set(s.id, n)
        if (n === 0) ready.push(s.id)
      }
    }
  }
  if (out.length !== steps.length) throw new Error('cycle in the step graph')
  return out
}

/** Every step that (transitively) depends on `id`. */
export function dependentsOf(steps: Step[], id: StepId): Set<StepId> {
  const out = new Set<StepId>()
  const visit = (x: StepId) => {
    for (const s of steps) {
      if (s.dependsOn.includes(x) && !out.has(s.id)) {
        out.add(s.id)
        visit(s.id)
      }
    }
  }
  visit(id)
  return out
}

function toStepError(e: unknown, logPath: string | undefined): StepError & { hint?: string } {
  if (e instanceof CwError) return { code: e.code, message: e.message, ...(logPath ? { log: logPath } : {}), ...(e.hint ? { hint: e.hint } : {}) }
  return { code: 'STEP_FAILED', message: (e as Error)?.message ?? String(e), ...(logPath ? { log: logPath } : {}) }
}

export async function runSteps(registry: Step[], ctx: Ctx, o: RunOptions = {}): Promise<RunReport> {
  const steps = topoSort(registry)
  const now = () => (o.now?.() ?? new Date()).toISOString()
  const outcomes: Partial<Record<StepId, StepOutcome>> = {}
  const ran: StepId[] = []
  const stale = new Set<StepId>()
  const st = ctx.state

  const finishGroupIfDone = (step: Step) => {
    const name = crmNameOf(step)
    if (!name) return
    const group = steps.filter((s) => crmNameOf(s) === name && !s.outward)
    const allDone = group.every((s) => ['done', 'skipped'].includes(st.step(s.id).status))
    if (allDone) enqueue(st, { step: name, status: 'ok', detail: group.map((s) => s.id).join(', '), at: now() })
  }

  const fail = (step: Step, e: unknown, exitCode: ExitCode, outcome: StepOutcome): RunReport => {
    const err = toStepError(e, ctx.log.stepLog(step.id))
    const { hint, ...stepError } = err
    st.patchStep(step.id, { status: 'failed', finishedAt: now(), error: stepError })
    outcomes[step.id] = outcome
    const name = crmNameOf(step)
    if (name) enqueue(st, { step: name, status: 'failed', detail: `${step.id}: ${err.code}: ${err.message}`.slice(0, 1000), at: now() })
    ctx.log.error(`step ${step.id} failed`, { code: err.code, message: err.message })
    for (const s of steps) if (!outcomes[s.id]) outcomes[s.id] = 'not-reached'
    return {
      ok: false,
      exitCode,
      outcomes,
      ran,
      failed: { step: step.id, code: err.code, message: err.message, ...(hint ? { hint } : {}) },
    }
  }

  for (const step of steps) {
    if (o.only && !o.only.includes(step.id)) {
      outcomes[step.id] = 'excluded'
      continue
    }
    const prev = st.step(step.id)

    if (step.outward) {
      try {
        const cmds = step.plan(ctx)
        st.patchStep(step.id, {
          status: 'planned',
          finishedAt: now(),
          note: `local mode; ${cmds.length} command(s) in outward-plan.md`,
          error: null,
        })
      } catch (e) {
        return fail(step, e, EXIT.STEP_FAILED, 'failed')
      }
      outcomes[step.id] = 'planned'
      const name = crmNameOf(step)
      if (name) enqueue(st, { step: name, status: 'skipped', detail: 'local mode; plan in outward-plan.md', at: now() })
      if (o.until === step.id) break
      continue
    }

    const reason = step.skipReason?.(ctx) ?? null
    if (reason) {
      if (prev.status !== 'skipped' || prev.note !== reason) st.patchStep(step.id, { status: 'skipped', note: reason, finishedAt: now(), error: null })
      outcomes[step.id] = 'skipped'
      finishGroupIfDone(step)
      if (o.until === step.id) break
      continue
    }

    let fp: string
    try {
      fp = step.fingerprint(ctx)
    } catch (e) {
      return fail(step, e, EXIT.STEP_FAILED, 'failed')
    }
    const fpChanged = prev.status === 'done' && prev.fingerprint !== undefined && prev.fingerprint !== fp
    const isStale = stale.has(step.id) || fpChanged || prev.stale === true
    if (isStale && prev.status === 'done') {
      // persisted, so a run that dies before reaching them still re-runs them next time
      for (const d of dependentsOf(steps, step.id)) {
        stale.add(d)
        if (st.step(d).status === 'done' && !st.step(d).stale) st.patchStep(d, { stale: true })
      }
      if (step.irreversible && !fpChanged) {
        // Inherited staleness: an upstream input changed, not this step's own.
        // Its artefacts (credentials, PAYLOAD_SECRET) may well be untouched, so
        // look at the world: complete → keep them, clear stale and move on.
        let p: Probe
        try {
          p = await step.probe(ctx)
        } catch (e) {
          return fail(step, e, EXIT.STEP_FAILED, 'failed')
        }
        if (p.state === 'done') {
          st.patchStep(step.id, { stale: false })
          outcomes[step.id] = 'skipped-done'
          ctx.log.info(`step ${step.id} stale by inheritance, probe done: kept`)
          finishGroupIfDone(step)
          if (o.until === step.id) break
          continue
        }
        // incomplete: fall through to a normal run, which for an irreversible
        // step only fills gaps and never regenerates
        st.patchStep(step.id, { stale: true })
      } else if (step.irreversible) {
        st.patchStep(step.id, { stale: true })
        return fail(
          step,
          new CwError('STALE_IRREVERSIBLE', `${step.id} is done but its own inputs changed; it is never re-run automatically`, {
            step: step.id,
            hint: 'Explain the change to Josef; regenerating credentials needs his explicit decision.',
          }),
          EXIT.CONFLICT,
          'conflict',
        )
      }
      st.patchStep(step.id, { stale: true })
    }

    let probe: Probe
    try {
      probe = await step.probe(ctx)
    } catch (e) {
      return fail(step, e, EXIT.STEP_FAILED, 'failed')
    }

    if (prev.status === 'done' && !isStale && probe.state === 'done') {
      outcomes[step.id] = 'skipped-done'
      finishGroupIfDone(step)
      if (o.until === step.id) break
      continue
    }

    if (probe.state === 'conflict') {
      return fail(step, new CwError(probe.code, probe.detail, { step: step.id }), new CwError(probe.code, '').exitCode, 'conflict')
    }

    st.patchStep(step.id, { status: 'running', attempts: prev.attempts + 1, startedAt: now(), error: null })
    ctx.log.info(`step ${step.id} start`, { probe: probe.state, attempt: prev.attempts + 1 })
    try {
      if (probe.state === 'partial') {
        ctx.log.info(`step ${step.id} recover`, { detail: probe.detail })
        await step.recover?.(ctx)
      }
      ctx.testHooks?.checkpoint(step.id, 'before')
      const outputs = await step.run(ctx)
      ctx.testHooks?.checkpoint(step.id, 'after')
      st.patchStep(step.id, { status: 'done', fingerprint: fp, finishedAt: now(), outputs, error: null, stale: false })
    } catch (e) {
      const code = e instanceof CwError ? e.exitCode : EXIT.STEP_FAILED
      return fail(step, e, code === EXIT.CONFLICT || code === EXIT.OUTWARD_REFUSED || code === EXIT.PRECONDITION ? code : EXIT.STEP_FAILED, code === EXIT.CONFLICT ? 'conflict' : 'failed')
    }
    ran.push(step.id)
    outcomes[step.id] = 'ran'
    ctx.log.info(`step ${step.id} done`)
    finishGroupIfDone(step)
    if (o.until === step.id) break
  }

  for (const s of steps) if (!outcomes[s.id]) outcomes[s.id] = 'not-reached'
  return { ok: true, exitCode: EXIT.OK, outcomes, ran }
}

/** The next step a resume would act on (for `cw status`). */
export function nextStep(registry: Step[], ctx: Pick<Ctx, 'state'>): StepId | null {
  for (const s of topoSort(registry)) {
    const status = ctx.state.step(s.id).status
    if (s.outward ? status !== 'planned' : !['done', 'skipped'].includes(status)) return s.id
  }
  return null
}
