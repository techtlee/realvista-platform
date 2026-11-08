/**
 * The step registry: one Step per STEP_IDS entry, in runbook order.
 *
 * `dependsOn` lists real data dependencies only, not "the previous step":
 * the runner re-runs every transitive dependant of a step whose inputs
 * changed, so a linear chain would turn a starter-copy edit into a full
 * rebuild (and would re-run the site-key step for nothing). Execution order
 * is still the runbook order, because the runner breaks ties by STEP_IDS.
 */
import { STEP_IDS, type Step, type StepId } from '../types.js'
import {
  backendCopy,
  backendCredentials,
  backendCustomize,
  backendDb,
  backendEnv,
  backendInstall,
  backendMigrate,
  backendSeedAdmin,
  backendSeedContent,
  backendSeedRealtor,
  backendStart,
  siteKey,
} from './backend.js'
import { OUTWARD_STEPS, crmReport, crmSiteRecord, handover, outwardPlan, verify } from './finish.js'
import { input, preflight, recordRepo, starterCopy } from './record.js'
import { siteBuild, siteCopy, siteEnv, siteInstall, siteStandalone, siteStart } from './site.js'

const ALL: Step[] = [
  preflight,
  input,
  crmSiteRecord,
  recordRepo,
  backendCopy,
  backendCustomize,
  backendInstall,
  backendDb,
  backendEnv,
  backendCredentials,
  backendMigrate,
  backendSeedAdmin,
  starterCopy,
  backendSeedContent,
  backendSeedRealtor,
  backendStart,
  siteKey,
  siteCopy,
  siteStandalone,
  siteEnv,
  siteInstall,
  siteBuild,
  siteStart,
  verify,
  crmReport,
  ...OUTWARD_STEPS,
  outwardPlan,
  handover,
]

/** Every step, in STEP_IDS order (a unit test asserts 1:1 coverage). */
export const STEPS: readonly Step[] = STEP_IDS.map((id) => {
  const s = ALL.find((x) => x.id === id)
  if (!s) throw new Error(`no step module for ${id}`)
  return s
})

export function getStep(id: StepId): Step {
  return STEPS.find((s) => s.id === id)!
}

export { STEPS as registry }

/** The CLI's loader contract (`createSteps()` or `steps`). */
export const steps: Step[] = [...STEPS]
export function createSteps(): Step[] {
  return [...STEPS]
}
