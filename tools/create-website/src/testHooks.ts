/**
 * Failure injection for the resume matrix (design §B "Failure injection").
 *
 * - CW_FAIL_AT=<stepId>:before|after  throws at that point
 * - CW_CRASH_AT=<stepId>:mid          exits the process with 137 halfway
 *                                     through a step that calls hooks.mid()
 *
 * Honoured only when CW_TEST_HOOKS=1 AND the config is a test config
 * (`testMode: true`) AND clientsDir is not the real Makleri/clients. If
 * CW_TEST_HOOKS=1 is set under any other config the engine refuses to run at
 * all, rather than silently ignoring it: someone expecting a crash that never
 * comes is how a real client dir gets "tested".
 */
import { isRealClientsDir } from './config.js'
import { CwError, isStepId, type Config, type StepId, type TestHooks } from './types.js'

export class InjectedFailure extends CwError {
  constructor(step: StepId, when: string) {
    super('STEP_FAILED', `injected failure (CW_FAIL_AT=${step}:${when})`, { step })
    this.name = 'InjectedFailure'
  }
}

function parsePoint(v: string | undefined, allowed: readonly string[], name: string): { step: StepId; when: string } | null {
  if (!v) return null
  const [step, when] = v.split(':')
  if (!step || !when || !isStepId(step) || !allowed.includes(when)) {
    throw new CwError('CONFIG_INVALID', `${name}=${v} is not <stepId>:${allowed.join('|')}`)
  }
  return { step, when }
}

export interface TestHooksOptions {
  env?: NodeJS.ProcessEnv
  /** injectable for unit tests; defaults to process.exit */
  exit?: (code: number) => never
}

/** Returns hooks, undefined when hooks are off, or throws TEST_HOOKS_REFUSED. */
export function createTestHooks(cfg: Config, o: TestHooksOptions = {}): TestHooks | undefined {
  const env = o.env ?? process.env
  const on = env.CW_TEST_HOOKS === '1'
  if (!on) {
    if (env.CW_FAIL_AT || env.CW_CRASH_AT) {
      throw new CwError('TEST_HOOKS_REFUSED', 'CW_FAIL_AT/CW_CRASH_AT are set without CW_TEST_HOOKS=1', {
        hint: 'Unset them; they are for the test suite only.',
      })
    }
    return undefined
  }
  if (!cfg.testMode) {
    throw new CwError('TEST_HOOKS_REFUSED', `CW_TEST_HOOKS=1 needs a test config (testMode: true); ${cfg.configPath} is not one`)
  }
  if (isRealClientsDir(cfg.clientsDir, env)) {
    throw new CwError('TEST_HOOKS_REFUSED', `CW_TEST_HOOKS=1 is never honoured with the real clients dir (${cfg.clientsDir})`)
  }
  const fail = parsePoint(env.CW_FAIL_AT, ['before', 'after'], 'CW_FAIL_AT')
  const crash = parsePoint(env.CW_CRASH_AT, ['mid'], 'CW_CRASH_AT')
  const exit = o.exit ?? ((code: number) => process.exit(code))
  return {
    checkpoint(step, when) {
      if (fail && fail.step === step && fail.when === when) throw new InjectedFailure(step, when)
    },
    mid(step) {
      if (crash && crash.step === step) exit(137)
    },
  }
}
