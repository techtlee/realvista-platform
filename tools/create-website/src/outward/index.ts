/**
 * Outward adapters (runbook 13–19): plan-only in this phase.
 *
 * The step modules use `outwardAdapter(stepId).plan(outwardInputFromCtx(ctx))`
 * and `toPlannedCommand` for each outward step id; the `outward-plan` step
 * writes `renderOutwardPlanMarkdown` / `renderOutwardPlanJson`.
 */
export * from './adapters.js'
export * from './dns.js'
export * from './input.js'
export * from './render.js'
export * from './types.js'
