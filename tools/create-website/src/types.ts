/**
 * The /create-website engine contract (CREATE-WEBSITE-DESIGN.md §A2/A3/A5).
 *
 * WP4 owns this file. Every other package (outward adapters, exporter, step
 * modules, e2e) codes against it. Changes after the first commit go through
 * the architect's review: additive is fine, renames are not.
 *
 * Only types plus a handful of runtime constants live here (step ids, error
 * codes, exit codes, the outward kill switch), so importing it never pulls
 * in fs/pg/child_process.
 */
import type { ProvisioningJson } from '@makleri/selection'

// ---------------------------------------------------------------------------
// Basics

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export const TOOL_VERSION = '0.1.0'
export const STATE_VERSION = 1

/**
 * Compile-time kill switch for every outward step (GitHub, Vercel, hosted
 * Postgres, DNS, go-live). Local mode is the only mode in this phase; an
 * outward adapter's `apply()` must throw `OutwardDisabledError` while this is
 * false. It is a `const` literal on purpose: flipping it is a code change that
 * goes through review, never an env var or a flag.
 */
export const OUTWARD_ENABLED = false as const

// ---------------------------------------------------------------------------
// Step ids — 1:1 with the A2 table, in topological/runbook order.

export const STEP_IDS = [
  'preflight', //              1  (new)
  'input', //                  2  runbook 4
  'crm-site-record', //        3  runbook 3 (check only)
  'record-repo', //            4
  'backend-copy', //           5  runbook 5
  'backend-customize', //      6  F14, dependabot
  'backend-install', //        7  runbook 5
  'backend-db', //             8  runbook 6
  'backend-env', //            9  runbook 6
  'backend-credentials', //   10  runbook 7
  'backend-migrate', //       11  runbook 6
  'backend-seed-admin', //    12  runbook 8
  'starter-copy', //          13  runbook 8 (copy)
  'backend-seed-content', //  14  runbook 8
  'backend-seed-realtor', //  15  runbook 8
  'backend-start', //         16  runbook 9
  'site-key', //              17  runbook 10
  'site-copy', //             18  runbook 11
  'site-standalone', //       19  runbook 11 (table)
  'site-env', //              20  runbook 10/11
  'site-install', //          21  runbook 12
  'site-build', //            22  runbook 12, F11
  'site-start', //            23  runbook 12
  'verify', //                24  phase D
  'crm-report', //            25  CRM log
  // outward (runbook 13–19): local mode = plan() only, status `planned`
  'github-repos',
  'postgres-hosting',
  'vercel-projects',
  'vercel-env',
  'fallback-domains',
  'deploy-hook', //              "not needed (ISR)"
  'client-dns',
  'dependabot-enable',
  'go-live',
  'outward-plan', //          writes clients/<slug>/outward-plan.{md,json}
  'handover', //              prints the summary JSON
] as const

export type StepId = (typeof STEP_IDS)[number]

export const OUTWARD_STEP_IDS = [
  'github-repos',
  'postgres-hosting',
  'vercel-projects',
  'vercel-env',
  'fallback-domains',
  'deploy-hook',
  'client-dns',
  'dependabot-enable',
  'go-live',
] as const satisfies readonly StepId[]

export type OutwardStepId = (typeof OUTWARD_STEP_IDS)[number]

export function isStepId(s: string): s is StepId {
  return (STEP_IDS as readonly string[]).includes(s)
}

/**
 * Coarse CRM provisioning-log names (client #1's names, A2 "CRM log names").
 * Several step ids roll up into one CRM entry; a step id without an entry
 * here is not reported to the CRM.
 */
export const CRM_LOG_NAMES = {
  input: 'provisioning-json',
  'backend-copy': 'backend-repo-local',
  'backend-customize': 'backend-repo-local',
  'backend-install': 'backend-repo-local',
  'backend-db': 'backend-seed',
  'backend-env': 'backend-seed',
  'backend-credentials': 'backend-seed',
  'backend-migrate': 'backend-seed',
  'backend-seed-admin': 'backend-seed',
  'starter-copy': 'backend-seed',
  'backend-seed-content': 'backend-seed',
  'backend-seed-realtor': 'backend-seed',
  'site-copy': 'site-repo-local',
  'site-standalone': 'site-repo-local',
  'site-env': 'site-repo-local',
  'site-install': 'site-repo-local',
  'site-build': 'site-repo-local',
  'site-start': 'site-repo-local',
  verify: 'verify',
  'github-repos': 'github-repos',
  'postgres-hosting': 'postgres-hosting',
  'vercel-projects': 'vercel-projects',
  'vercel-env': 'vercel-env',
  'fallback-domains': 'fallback-dns',
  'deploy-hook': 'deploy-hook',
  'client-dns': 'client-dns',
  'dependabot-enable': 'dependabot',
  'go-live': 'go-live',
} as const satisfies Partial<Record<StepId, string>>

export type CrmLogName = (typeof CRM_LOG_NAMES)[keyof typeof CRM_LOG_NAMES]

// ---------------------------------------------------------------------------
// Errors and exit codes (A4)

export const EXIT = {
  OK: 0,
  INVALID_INPUT: 2,
  CONFLICT: 3,
  PRECONDITION: 4,
  STEP_FAILED: 5,
  LOCKED: 6,
  OUTWARD_REFUSED: 7,
} as const
export type ExitCode = (typeof EXIT)[keyof typeof EXIT] | 1

/** Every error code the CLI can emit, with the exit code it maps to. */
export const ERROR_CODES = {
  INVALID_INPUT: EXIT.INVALID_INPUT,
  RESERVED_SLUG: EXIT.INVALID_INPUT,
  INVALID_STARTER_COPY: EXIT.INVALID_INPUT,
  INPUT_CHANGED: EXIT.CONFLICT,
  SLUG_TAKEN: EXIT.CONFLICT,
  TARGET_EXISTS: EXIT.CONFLICT,
  DB_EXISTS: EXIT.CONFLICT,
  PORT_BUSY: EXIT.CONFLICT,
  STALE_IRREVERSIBLE: EXIT.CONFLICT,
  CONFIG_INVALID: EXIT.PRECONDITION,
  PRECONDITION: EXIT.PRECONDITION,
  TOOL_MISSING: EXIT.PRECONDITION,
  TEMPLATE_TOO_OLD: EXIT.PRECONDITION,
  POSTGRES_UNREACHABLE: EXIT.PRECONDITION,
  NO_FREE_PORT: EXIT.PRECONDITION,
  NOT_FOUND: EXIT.PRECONDITION,
  CRM_UNQUALIFIED: EXIT.INVALID_INPUT,
  CRM_NO_SITE: EXIT.PRECONDITION,
  CRM_UNREACHABLE: EXIT.PRECONDITION,
  TEST_HOOKS_REFUSED: EXIT.PRECONDITION,
  STEP_FAILED: EXIT.STEP_FAILED,
  CRASHED: EXIT.STEP_FAILED,
  LOCKED: EXIT.LOCKED,
  OUTWARD_REFUSED: EXIT.OUTWARD_REFUSED,
  EXEC_REFUSED: EXIT.OUTWARD_REFUSED,
} as const satisfies Record<string, ExitCode>

export type ErrorCode = keyof typeof ERROR_CODES

/** The one error type the CLI turns into `{ok:false, code, step, message, hint, statePath}`. */
export class CwError extends Error {
  readonly code: ErrorCode
  readonly step: StepId | undefined
  readonly hint: string | undefined
  readonly details: Json | undefined
  constructor(
    code: ErrorCode,
    message: string,
    opts: { step?: StepId; hint?: string; details?: Json; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = 'CwError'
    this.code = code
    this.step = opts.step
    this.hint = opts.hint
    this.details = opts.details
  }
  get exitCode(): ExitCode {
    return ERROR_CODES[this.code]
  }
}

/** Thrown by every outward `apply()` while `OUTWARD_ENABLED` is false. */
export class OutwardDisabledError extends CwError {
  constructor(what: string) {
    super('OUTWARD_REFUSED', `${what}: outward steps are disabled in this phase (local mode only)`, {
      hint: 'Read clients/<slug>/outward-plan.md; the lead runs production steps by hand.',
    })
    this.name = 'OutwardDisabledError'
  }
}

// ---------------------------------------------------------------------------
// Step contract (A2)

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'planned'

export type Probe =
  | { state: 'done' }
  | { state: 'absent' }
  | { state: 'partial'; detail: string }
  | { state: 'conflict'; code: ErrorCode; detail: string }

/** A reference to a secret, never a value. `file` is a logical id, see `SecretFileId`. */
export type SecretRef = { file: SecretFileId; key: string }

/**
 * Logical secret files, resolved against `Ctx.paths`:
 * `backend/.env`, `backend/.admin-credentials.local`, `site/.env.local`.
 *
 * The `*.env.production.local` ids exist only so outward `plan()` output can
 * REFERENCE production secrets (`stdin: {file, key}`). The SecretStore
 * refuses to read or write them while OUTWARD_ENABLED is false.
 */
export type LocalSecretFileId = 'backend/.env' | 'backend/.admin-credentials.local' | 'site/.env.local'
export type ProductionSecretFileId = 'backend/.env.production.local' | 'site/.env.production.local'
export type SecretFileId = LocalSecretFileId | ProductionSecretFileId

export interface PlannedCommand {
  id: string
  description: string
  argv: string[]
  envNames: string[]
  stdin?: SecretRef
  idempotencyProbe?: string[]
  note?: string
}

export type Phase = 'A' | 'B' | 'C' | 'D' | 'E'

export interface Step {
  id: StepId
  /** runbook step reference, e.g. "5", "10/11", "(new)" */
  runbook: string
  phase: Phase
  crmLogName?: string
  outward: boolean
  dependsOn: StepId[]
  /**
   * "Never re-run" steps (backend-credentials): a changed fingerprint on a
   * done step stops with STALE_IRREVERSIBLE instead of re-running.
   */
  irreversible?: boolean
  /** Return a reason to mark the step `skipped` (e.g. crm-site-record for file input), else null. */
  skipReason?(ctx: Ctx): string | null
  /** hash of the inputs that matter to this step */
  fingerprint(ctx: Ctx): string
  /** look at the world, not at state */
  probe(ctx: Ctx): Promise<Probe>
  /** clean up only what THIS runId left half-done */
  recover?(ctx: Ctx): Promise<void>
  /** returns non-secret outputs into state */
  run(ctx: Ctx): Promise<Record<string, Json>>
  /** never executes */
  plan(ctx: Ctx): PlannedCommand[]
}

// ---------------------------------------------------------------------------
// Input (A1)

/**
 * `provisioningRequestSchema` v1 (P3, `@makleri/selection`). Structural copy
 * so this file compiles before WP1 lands; `src/input` validates with the real
 * schema.
 */
export interface ProvisioningRequest {
  requestVersion: 1
  slug: string
  crm?: { leadId: number; siteId: number; url?: string }
  contact: { name: string; email: string; phone?: string }
  company?: { name?: string; ico?: string; city?: string }
  provisioning: ProvisioningJson
}

export type InputSource = 'file' | 'crm' | 'bare-json'

// ---------------------------------------------------------------------------
// Config (A0)

export interface Config {
  /** absolute path of the create-website.config.json that was loaded */
  configPath: string
  /** directory of the config file; relative paths resolve against it */
  rootDir: string
  clientsDir: string
  platformRepo: string
  cmsRepo: string
  cmsRef: string
  postgres: { host: string; port: number; user?: string; passwordFile?: string }
  dbPrefix: string
  ports: { site: [number, number]; backend: [number, number]; reserved: number[] }
  crm?: { url: string; credentialsFile?: string; apiKeyFile?: string }
  subdomainBase: string
  /**
   * Test/eval configs set this. CW_TEST_HOOKS is honoured only when true, and
   * never when `clientsDir` is the real Makleri/clients.
   */
  testMode: boolean
}

// ---------------------------------------------------------------------------
// State (A3)

export interface StepError {
  code: ErrorCode
  message: string
  log?: string
}

export interface StepState {
  status: StepStatus
  attempts: number
  fingerprint?: string
  startedAt?: string
  finishedAt?: string
  outputs?: Record<string, Json>
  error?: StepError | null
  /** set when a dependency's fingerprint changed after this step was done */
  stale?: boolean
  /** why the step was skipped/planned */
  note?: string
}

export interface CrmOutboxEntry {
  /** `<runId>:<crmLogName>:<status>` — the server dedupes on it */
  key: string
  step: string
  status: 'ok' | 'failed' | 'skipped'
  at: string
  detail: string
  sent: boolean
  sentAt?: string
  lastError?: string
}

export interface VerifyCheck {
  check: string
  ok: boolean
  detail: string
}

export interface ProcessRecord {
  pid: number
  port: number
  log: string
  startedAt?: string
}

export interface CwState {
  stateVersion: typeof STATE_VERSION
  toolVersion: string
  runId: string
  slug: string
  mode: 'local'
  createdAt: string
  updatedAt: string
  input: {
    source: InputSource
    path?: string
    crm?: { url: string; leadId?: number; siteId?: number }
    requestSha256: string
    provisioningSha256: string
  }
  templates: {
    platform?: { repo: string; commit: string; themeVersion?: string }
    cms?: { repo: string; commit: string; templateApiVersion?: number }
  }
  paths: { record: string; backend: string; site: string }
  ports: { site: number; backend: number }
  db?: { name: string; host: string; port: number; createdByRun: string | null }
  tenantId?: number
  siteKey?: { mintedAt: string; verifiedAt?: string }
  /** secret file id → key NAMES (never values) */
  secrets: Partial<Record<SecretFileId, string[]>>
  steps: Partial<Record<StepId, StepState>>
  processes: { backend: ProcessRecord | null; site: ProcessRecord | null }
  verify: VerifyCheck[]
  crmOutbox: CrmOutboxEntry[]
}

export interface StateStore {
  readonly path: string
  /** current in-memory snapshot (do not mutate; use update) */
  get(): CwState
  /** mutate + atomic write (temp file + rename) */
  update(mutator: (s: CwState) => void): CwState
  step(id: StepId): StepState
  patchStep(id: StepId, patch: Partial<StepState>): StepState
}

// ---------------------------------------------------------------------------
// Services handed to steps

export interface ExecOptions {
  cwd: string
  /** merged over a minimal inherited env; secrets go here, never in argv */
  env?: Record<string, string>
  /**
   * env entries whose values are always treated as secrets (registered for
   * redaction and the argv guard). Keys in `env` are registered only when
   * their name classifies as secret (see secrets.ts classifyKey).
   */
  secretEnv?: Record<string, string>
  /** replaces the inherited env entirely when true */
  cleanEnv?: boolean
  stdin?: string
  timeoutMs?: number
  /** when set, redacted stdout/stderr are appended to this log file */
  logFile?: string
  /** resolve instead of throwing on a non-zero exit */
  allowFailure?: boolean
}

export interface ExecResult {
  code: number
  /** redacted */
  stdout: string
  /** redacted */
  stderr: string
}

export interface Exec {
  /** throws CwError EXEC_REFUSED for forbidden commands or secret values in argv */
  run(argv: string[], opts: ExecOptions): Promise<ExecResult>
  /** the same guard, without running anything */
  assertAllowed(argv: string[]): void
}

export interface SecretStore {
  /** absolute path of a logical secret file */
  pathOf(file: SecretFileId): string
  /** creates the key with gen() if missing; never overwrites; returns whether it created */
  ensure(file: SecretFileId, key: string, gen: () => string): Promise<{ created: boolean }>
  /** in-process only */
  get(ref: SecretRef): Promise<string | undefined>
  has(ref: SecretRef): Promise<boolean>
  /** explicit overwrite (site-env rewrite, re-minted site key); atomic, 0600 */
  set(ref: SecretRef, value: string): Promise<void>
  keys(file: SecretFileId): Promise<string[]>
  /** crypto.randomBytes based */
  generate(bytes?: number): string
  /** every secret value seen so far (for redaction and the exec guard) */
  knownValues(): string[]
  /** add a value obtained elsewhere (e.g. a minted key read from a temp file) */
  register(value: string): void
}

export interface LocalPostgres {
  ping(): Promise<void>
  databaseExists(name: string): Promise<boolean>
  createDatabase(name: string): Promise<void>
  dropDatabase(name: string): Promise<void>
  listDatabases(prefix: string): Promise<string[]>
  /** a DATABASE_URL — treat as a secret */
  url(name: string): string
}

export interface StartProcessOptions {
  name: 'backend' | 'site'
  argv: string[]
  cwd: string
  env?: Record<string, string>
  logFile: string
  port: number
}

export interface ProcessManager {
  startDetached(o: StartProcessOptions): Promise<{ pid: number }>
  isAlive(pid: number): boolean
  stop(pid: number, opts?: { timeoutMs?: number }): Promise<void>
  /** pid listening on the port, or null */
  pidOnPort(port: number): Promise<number | null>
  isPortFree(port: number): Promise<boolean>
}

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD'
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  redirect?: 'manual' | 'follow'
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  text: string
}

export interface Http {
  request(r: HttpRequest): Promise<HttpResponse>
}

export interface RunLogger {
  /** directory logs/<runId>/ under the record repo */
  readonly dir: string
  info(msg: string, data?: Record<string, Json>): void
  warn(msg: string, data?: Record<string, Json>): void
  error(msg: string, data?: Record<string, Json>): void
  /** per-step log file path (logs/<runId>/<stepId>.log) */
  stepLog(step: StepId): string
}

export type HookPoint = 'before' | 'after' | 'mid'

export interface TestHooks {
  /** throws when CW_FAIL_AT=<step>:<when> */
  checkpoint(step: StepId, when: 'before' | 'after'): void
  /** exits the process with 137 when CW_CRASH_AT=<step>:mid */
  mid(step: StepId): void
}

export interface Ctx {
  cfg: Config
  state: StateStore
  exec: Exec
  secrets: SecretStore
  pg: LocalPostgres
  procs: ProcessManager
  http: Http
  log: RunLogger
  request: ProvisioningRequest
  paths: { record: string; backend: string; site: string }
  testHooks?: TestHooks
}
