/**
 * A fake step registry for the fast failure matrix, loaded by the real CLI
 * through CW_STEPS_MODULE (honoured only under a testMode config).
 *
 * One step per STEP_ID, a linear chain in table order. The "world" is a
 * directory (CW_FAKE_WORLD):
 * - `<id>.done`       the artefact exists → probe `done`
 * - `<id>.partial`    half-written by a crash, tagged with the runId → probe `partial`
 * - `credentials`     written once by backend-credentials (ensure, never overwrite)
 * - `calls.log`       one line per run()/recover() call, across processes
 *
 * Always-re-run steps (probe always `absent`): preflight, backend-migrate,
 * verify, outward-plan, handover — as in the design's A2 table.
 * `mid` hooks: backend-copy, site-copy, backend-env, backend-credentials,
 * site-key, backend-seed-content.
 * Fingerprints are constant unless CW_FAKE_FP_<STEP_ID with _ for -> is set.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { OUTWARD_STEP_IDS, STEP_IDS, type Ctx, type Probe, type Step, type StepId } from '../../../src/types.js'

export const ALWAYS = new Set<StepId>(['preflight', 'backend-migrate', 'verify', 'outward-plan', 'handover'])
export const MID = new Set<StepId>(['backend-copy', 'site-copy', 'backend-env', 'backend-credentials', 'site-key', 'backend-seed-content'])

function world(): string {
  const w = process.env.CW_FAKE_WORLD
  if (!w) throw new Error('CW_FAKE_WORLD is not set')
  mkdirSync(w, { recursive: true })
  return w
}
const log = (line: string) => appendFileSync(join(world(), 'calls.log'), `${line}\n`)
const fpEnv = (id: StepId) => process.env[`CW_FAKE_FP_${id.replace(/-/g, '_').toUpperCase()}`]

function makeStep(id: StepId, i: number): Step {
  const outward = (OUTWARD_STEP_IDS as readonly string[]).includes(id)
  const prev = i > 0 ? STEP_IDS[i - 1]! : null
  const step: Step = {
    id,
    runbook: 'fake',
    phase: 'B',
    outward,
    dependsOn: prev ? [prev] : [],
    ...(id === 'backend-credentials' ? { irreversible: true } : {}),
    ...(id === 'crm-site-record' ? { skipReason: () => 'file input (fake world)' } : {}),
    fingerprint: () => `fake:${id}:${fpEnv(id) ?? 'v1'}`,
    async probe(ctx: Ctx): Promise<Probe> {
      if (ALWAYS.has(id)) return { state: 'absent' }
      const w = world()
      if (existsSync(join(w, `${id}.done`))) return { state: 'done' }
      if (existsSync(join(w, `${id}.partial`))) {
        const tag = readFileSync(join(w, `${id}.partial`), 'utf8').trim()
        if (tag !== ctx.state.get().runId) return { state: 'conflict', code: 'TARGET_EXISTS', detail: `${id}.partial from another run (${tag})` }
        return { state: 'partial', detail: `${id}.partial left by ${tag}` }
      }
      return { state: 'absent' }
    },
    async recover(ctx: Ctx) {
      log(`recover ${id} ${ctx.state.get().runId}`)
      rmSync(join(world(), `${id}.partial`), { force: true })
    },
    async run(ctx: Ctx) {
      if (outward) throw new Error(`BUG: outward step ${id} run() in local mode`)
      const w = world()
      log(`run ${id} ${ctx.state.get().runId}`)
      writeFileSync(join(w, `${id}.partial`), ctx.state.get().runId)
      if (MID.has(id)) ctx.testHooks?.mid(id)
      if (id === 'backend-credentials' && !existsSync(join(w, 'credentials'))) {
        writeFileSync(join(w, 'credentials'), randomBytes(16).toString('hex'), { mode: 0o600 })
      }
      renameSync(join(w, `${id}.partial`), join(w, `${id}.done`))
      return { fake: true }
    },
    plan: () => (outward ? [{ id: `${id}-plan`, description: `fake plan for ${id}`, argv: ['echo', id], envNames: [] }] : []),
  }
  return step
}

export function createSteps(): Step[] {
  return STEP_IDS.map((id, i) => makeStep(id, i))
}
