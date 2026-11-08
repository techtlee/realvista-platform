/**
 * `cw` — the /create-website CLI (A4). stdout carries only JSON summaries
 * (`--json`: one line; otherwise indented). Errors are
 * `{ok:false, code, step, message, hint, statePath}` with the A4 exit codes:
 * 0 ok, 2 invalid input, 3 conflict, 4 precondition, 5 step failed
 * (resumable), 6 locked, 7 outward refused.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { clientPaths, isRealClientsDir, loadConfig } from './config.js'
import { CrmClient } from './crm/client.js'
import { FetchHttp } from './crm/http.js'
import { flushOutbox, type FlushResult } from './crm/outbox.js'
import { dbName } from './dbname.js'
import { NodeExec } from './exec.js'
import { loadInput, validateOrThrow, validateRequest, type InputArgs, type ValidInput } from './input/load.js'
import { RESERVED_SLUGS, catalog } from './input/schema.js'
import { slugifyCzech } from './input/slug.js'
import { acquireLock, type Lock } from './lock.js'
import { FileRunLogger, MemoryRunLogger } from './log.js'
import { PgLocalPostgres } from './pg/local.js'
import { allocatePorts, readRegistry, releasePorts } from './ports.js'
import { NodeProcessManager } from './procs/manager.js'
import { Redactor } from './redact.js'
import { nextStep, runSteps, topoSort, type RunReport } from './runner.js'
import { FileSecretStore, namedSecrets, scanForLeaks, type LeakHit } from './secrets.js'
import { FileStateStore, MemoryStateStore, statePath } from './state/store.js'
import { newRunId } from './state/runId.js'
import { createTestHooks } from './testHooks.js'
import {
  CwError,
  EXIT,
  OUTWARD_ENABLED,
  OUTWARD_STEP_IDS,
  STEP_IDS,
  TOOL_VERSION,
  isStepId,
  type Config,
  type Ctx,
  type CwState,
  type ExitCode,
  type Json,
  type ProvisioningRequest,
  type StateStore,
  type Step,
  type StepId,
  type TestHooks,
} from './types.js'

export const HELP = `cw ${TOOL_VERSION} — provision a REALVISTA client locally (/create-website engine)

Usage: cw <command> [options]

Input (validate, plan, run) — exactly one of:
  --request <file>            provisioning request envelope (preferred)
  --lead <id>                 fetch the envelope from the CRM (GET /api/leads/:id/provisioning-request)
  --json <file> --slug <s> --contact-name <n> --contact-email <e> [--contact-phone <p>] [--city <c>]
                              bare provisioning JSON; the CLI builds the envelope

Commands:
  validate   <input>                       validate only; exit 2 with per-path issues
  plan       <input> [--outward]           print the step graph + exact commands; executes nothing
  run        <input> [--site-port N] [--backend-port N]
  run        <slug>                        resume from clients/<slug>/provisioning-request.json
  status     <slug>                        state summary, next step, last error + hint
  verify     <slug>                        re-run the acceptance checks
  stop       <slug>                        stop the local backend and site processes
  report-crm <slug>                        flush the CRM log outbox
  copy       init|validate <slug>          starter-copy.json
  secrets-check <slug>                     scan tracked files, logs, state and plan for secret values
  show-login <slug>                        URLs, realtor e-mail, credentials FILE PATH (never the password)
  teardown   <slug> --yes --confirm-slug <slug>   local only; refuses after any outward step or with a git remote
  slugify    <name>                        propose a slug for a brand name
  secret-pipe …                            placeholder for production steps; always refuses (exit 7) in local mode

Global options:
  --config <file>   create-website.config.json (default: search upwards from cwd)
  --json            one-line JSON on stdout
  -h, --help        this help

Exit codes: 0 ok, 2 invalid input, 3 conflict, 4 precondition, 5 step failed (resumable), 6 locked, 7 outward refused.
Outward steps (GitHub, Vercel, hosted Postgres, DNS, go-live) are plan-only: OUTWARD_ENABLED=${String(OUTWARD_ENABLED)}.
`

/** What to tell the operator per error code (references/errors.md mirrors this). */
export const HINTS: Partial<Record<string, string>> = {
  INVALID_INPUT: 'Fix the request at its source (CRM qualification), download it again, then `cw validate`.',
  INPUT_CHANGED: 'The request differs from the one this client was provisioned from. Ask Josef: keep the old one, or `cw teardown` and start fresh.',
  SLUG_TAKEN: 'Another lead already owns this slug. Propose a different slug (e.g. <slug>-2) or change it in the CRM.',
  TARGET_EXISTS: 'A directory is in the way and was not made by this tool. Inspect it; Josef moves it away himself.',
  DB_EXISTS: 'The database exists but was not created by this run. Inspect it; never drop it from here.',
  PORT_BUSY: 'Another process holds the port. Stop it, or pass --site-port/--backend-port.',
  STALE_IRREVERSIBLE: 'Credentials are never regenerated automatically. Explain the input change to Josef.',
  STEP_FAILED: 'Read `cw status` and the step log, fix the cause, then `cw run <slug>` resumes.',
  CRASHED: 'The previous run died mid-step. `cw run <slug>` resumes; the step re-probes and recovers.',
  LOCKED: 'Another run is active for this client. Wait for it or stop it.',
  CRM_UNQUALIFIED: 'Finish qualification in the CRM (the missing fields are listed), then retry.',
  CRM_NO_SITE: 'Create the site record in the CRM first (runbook step 3).',
}

interface Io {
  stdout: (s: string) => void
  stderr: (s: string) => void
  cwd: string
  env: NodeJS.ProcessEnv
}

const OPTIONS = {
  config: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  request: { type: 'string' },
  lead: { type: 'string' },
  slug: { type: 'string' },
  'contact-name': { type: 'string' },
  'contact-email': { type: 'string' },
  'contact-phone': { type: 'string' },
  'company-name': { type: 'string' },
  city: { type: 'string' },
  outward: { type: 'boolean' },
  'site-port': { type: 'string' },
  'backend-port': { type: 'string' },
  yes: { type: 'boolean' },
  'confirm-slug': { type: 'string' },
} as const

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values']

// ---------------------------------------------------------------------------
// Runtime assembly

export interface Runtime {
  cfg: Config
  redactor: Redactor
  secrets: FileSecretStore
  exec: NodeExec
  http: FetchHttp
  crm: CrmClient | null
  testHooks: TestHooks | undefined
}

function runtime(cfg: Config, paths: { backend: string; site: string }, io: Io, testHooks: TestHooks | undefined): Runtime {
  const redactor = new Redactor()
  const secrets = new FileSecretStore(paths, redactor, (m) => io.stderr(`warning: ${m}\n`))
  secrets.preload()
  const exec = new NodeExec({ redactor })
  const http = new FetchHttp()
  return { cfg, redactor, secrets, exec, http, crm: CrmClient.fromConfig(cfg, http, redactor, io.env), testHooks }
}

function buildCtx(rt: Runtime, state: StateStore, request: ProvisioningRequest, paths: Ctx['paths'], logDir?: string): Ctx {
  const s = state.get()
  return {
    cfg: rt.cfg,
    state,
    exec: rt.exec,
    secrets: rt.secrets,
    pg: new PgLocalPostgres(rt.cfg),
    procs: new NodeProcessManager(rt.exec),
    http: rt.http,
    log: logDir === undefined ? new FileRunLogger(paths.record, s.runId, rt.redactor) : new MemoryRunLogger(logDir),
    request,
    paths,
    ...(rt.testHooks ? { testHooks: rt.testHooks } : {}),
  }
}

/**
 * The step registry is WP6's `src/steps/registry.ts`, exporting
 * `createSteps(): Step[]` (or `steps: Step[]`). Test configs may point
 * CW_STEPS_MODULE at a fake registry.
 */
export async function loadSteps(cfg: Config, env: NodeJS.ProcessEnv): Promise<Step[] | null> {
  let url: string
  if (env.CW_STEPS_MODULE) {
    if (!cfg.testMode) throw new CwError('TEST_HOOKS_REFUSED', 'CW_STEPS_MODULE is honoured only under a test config (testMode: true)')
    url = pathToFileURL(resolve(env.CW_STEPS_MODULE)).href
  } else {
    url = new URL('./steps/registry.js', import.meta.url).href
  }
  let m: { createSteps?: () => Step[]; steps?: Step[] }
  try {
    m = (await import(url)) as typeof m
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { url?: string }
    if (err.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes('steps/registry')) return null
    throw e
  }
  const steps = typeof m.createSteps === 'function' ? m.createSteps() : m.steps
  if (!Array.isArray(steps)) throw new Error(`${url} exports neither createSteps() nor steps`)
  return steps
}

async function requireSteps(cfg: Config, env: NodeJS.ProcessEnv): Promise<Step[]> {
  const steps = await loadSteps(cfg, env)
  if (!steps) {
    throw new CwError('PRECONDITION', 'the step registry (src/steps/registry.ts) is not in this checkout yet', {
      hint: 'It lands with CW-WP6; `cw validate` and `cw status` work without it.',
    })
  }
  return steps
}

// ---------------------------------------------------------------------------
// helpers

function inputArgs(v: Values): InputArgs {
  const a: InputArgs = {}
  if (v.request !== undefined) a.request = v.request
  const jsonFile = (v as { json?: unknown }).json
  if (typeof jsonFile === 'string') a.json = jsonFile
  if (v.lead !== undefined) {
    const n = Number(v.lead)
    if (!Number.isInteger(n) || n <= 0) throw new CwError('INVALID_INPUT', `--lead must be a positive integer, got "${v.lead}"`)
    a.lead = n
  }
  if (v.slug !== undefined) a.slug = v.slug
  if (v['contact-name'] !== undefined) a.contactName = v['contact-name']
  if (v['contact-email'] !== undefined) a.contactEmail = v['contact-email']
  if (v['contact-phone'] !== undefined) a.contactPhone = v['contact-phone']
  if (v['company-name'] !== undefined) a.companyName = v['company-name']
  if (v.city !== undefined) a.city = v.city
  return a
}

function hasInput(v: Values): boolean {
  return v.request !== undefined || v.lead !== undefined || (v as { json?: unknown }).json !== undefined
}

function port(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new CwError('INVALID_INPUT', `${name} must be a port number`)
  return n
}

function requireSlug(positional: string | undefined, cmd: string): string {
  if (!positional) throw new CwError('INVALID_INPUT', `cw ${cmd} needs a <slug>`)
  if (!/^[a-z0-9-]{1,63}$/.test(positional)) throw new CwError('INVALID_INPUT', `"${positional}" is not a slug`)
  return positional
}

function loadState(cfg: Config, slug: string, secretValues?: () => Iterable<string>): FileStateStore {
  const p = statePath(clientPaths(cfg, slug).record)
  if (!existsSync(p)) {
    throw new CwError('NOT_FOUND', `no create-website state for "${slug}" in ${cfg.clientsDir}`, {
      hint: 'Nothing was provisioned under this slug with this config. Start with `cw validate` and `cw run`.',
    })
  }
  return FileStateStore.load(p, secretValues ? { secretValues } : {})
}

function storedRequest(record: string): ProvisioningRequest {
  const p = join(record, 'provisioning-request.json')
  if (!existsSync(p)) throw new CwError('NOT_FOUND', `${p} is missing (the input step has not completed)`)
  return validateOrThrow(JSON.parse(readFileSync(p, 'utf8'))).request
}

function urls(s: Pick<CwState, 'ports'>) {
  return { site: `http://localhost:${s.ports.site}`, backend: `http://localhost:${s.ports.backend}`, admin: `http://localhost:${s.ports.backend}/admin` }
}

function withLock<T>(record: string, runId: string, io: Io, fn: (lock: Lock) => Promise<T>): Promise<T> {
  const lock = acquireLock(record, runId, { onTakeover: (old) => io.stderr(`taking over a stale lock from pid ${old.pid} (run ${old.runId})\n`) })
  const release = () => lock.release()
  process.once('exit', release)
  return fn(lock).finally(() => {
    process.off('exit', release)
    release()
  })
}

async function flush(rt: Runtime, state: StateStore, request: ProvisioningRequest | null): Promise<FlushResult> {
  return flushOutbox(state, rt.crm, request?.crm?.siteId)
}

function summary(report: RunReport) {
  const counts: Record<string, number> = {}
  for (const o of Object.values(report.outcomes)) counts[o!] = (counts[o!] ?? 0) + 1
  return counts
}

// ---------------------------------------------------------------------------
// commands

async function cmdValidate(v: Values, io: Io, cfg: Config): Promise<{ out: Record<string, Json>; code: ExitCode }> {
  const crm = v.lead !== undefined ? CrmClient.fromConfig(cfg, new FetchHttp(), undefined, io.env) : null
  const loaded = await loadInput(inputArgs(v), { cwd: io.cwd, crm })
  const r = validateRequest(loaded.raw)
  if (!r.ok) {
    const reserved = r.issues.some((i) => i.path === 'slug' && /reserved/i.test(i.message))
    return {
      code: EXIT.INVALID_INPUT,
      out: {
        ok: false,
        code: reserved ? 'RESERVED_SLUG' : 'INVALID_INPUT',
        step: 'input',
        message: `the request is invalid (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`,
        hint: HINTS.INVALID_INPUT!,
        issues: r.issues as unknown as Json,
        source: loaded.source,
        statePath: null,
      },
    }
  }
  const { request: q, requestSha256, provisioningSha256 } = r.value
  const p = q.provisioning
  const paths = clientPaths(cfg, q.slug)
  const existing = existsSync(statePath(paths.record)) ? FileStateStore.load(statePath(paths.record)).get() : null
  return {
    code: EXIT.OK,
    out: {
      ok: true,
      source: loaded.source,
      slug: q.slug,
      contact: { name: q.contact.name, email: q.contact.email },
      theme: { name: p.theme.name, variant: p.theme.variant },
      homeSections: p.sections.home,
      domain: p.domain as unknown as Json,
      plan: p.plan as unknown as Json,
      crm: (q.crm ?? null) as unknown as Json,
      requestSha256,
      provisioningSha256,
      existingState: existing
        ? { runId: existing.runId, sameRequest: existing.input.requestSha256 === requestSha256, statePath: statePath(paths.record) }
        : null,
    },
  }
}

async function cmdPlan(v: Values, io: Io, cfg: Config): Promise<{ out: Record<string, Json>; code: ExitCode }> {
  const crm = v.lead !== undefined ? CrmClient.fromConfig(cfg, new FetchHttp(), undefined, io.env) : null
  const loaded = await loadInput(inputArgs(v), { cwd: io.cwd, crm })
  const valid = validateOrThrow(loaded.raw)
  const steps = await requireSteps(cfg, io.env)
  const paths = clientPaths(cfg, valid.request.slug)
  const reg = readRegistry(cfg.clientsDir).slugs[valid.request.slug]
  const sp = statePath(paths.record)
  const base = existsSync(sp) ? FileStateStore.load(sp).get() : null
  const state = new MemoryStateStore(
    base ??
      ({
        stateVersion: 1,
        toolVersion: TOOL_VERSION,
        runId: 'cw-plan',
        slug: valid.request.slug,
        mode: 'local',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        input: { source: loaded.source, requestSha256: valid.requestSha256, provisioningSha256: valid.provisioningSha256 },
        templates: {},
        paths,
        ports: { site: port(v['site-port'], '--site-port') ?? reg?.site ?? cfg.ports.site[0], backend: port(v['backend-port'], '--backend-port') ?? reg?.backend ?? cfg.ports.backend[0] },
        db: { name: dbName(valid.request.slug, cfg.dbPrefix), host: cfg.postgres.host, port: cfg.postgres.port, createdByRun: null },
        secrets: {},
        steps: {},
        processes: { backend: null, site: null },
        verify: [],
        crmOutbox: [],
      } satisfies CwState),
  )
  const rt = runtime(cfg, paths, io, undefined)
  const ctx = buildCtx(rt, state, valid.request, paths, '')
  const out: Json[] = []
  for (const s of topoSort(steps)) {
    if (v.outward && !s.outward) continue
    out.push({
      id: s.id,
      runbook: s.runbook,
      phase: s.phase,
      outward: s.outward,
      dependsOn: s.dependsOn,
      status: state.step(s.id).status,
      commands: s.plan(ctx).map((c) => rt.redactor.redact(JSON.stringify(c))).map((x) => JSON.parse(x) as Json),
    })
  }
  return {
    code: EXIT.OK,
    out: { ok: true, slug: valid.request.slug, mode: 'local', outwardEnabled: OUTWARD_ENABLED, ports: state.get().ports, steps: out, executed: false },
  }
}

async function cmdRun(v: Values, positional: string | undefined, io: Io, cfg: Config, hooks: TestHooks | undefined) {
  // 1. input (validated before anything is created on disk)
  let valid: ValidInput
  let source: CwState['input']['source']
  let inputPath: string | undefined
  let leadId: number | undefined
  const crmForInput = v.lead !== undefined ? CrmClient.fromConfig(cfg, new FetchHttp(), undefined, io.env) : null
  if (hasInput(v)) {
    const loaded = await loadInput(inputArgs(v), { cwd: io.cwd, crm: crmForInput })
    valid = validateOrThrow(loaded.raw)
    source = loaded.source
    inputPath = loaded.path
    leadId = loaded.leadId
  } else {
    const slug = requireSlug(positional, 'run')
    const prev = loadState(cfg, slug).get()
    valid = validateOrThrow(JSON.parse(readFileSync(join(prev.paths.record, 'provisioning-request.json'), 'utf8')))
    source = prev.input.source
    inputPath = prev.input.path
    leadId = prev.input.crm?.leadId
  }
  const req = valid.request
  const paths = clientPaths(cfg, req.slug)
  const sp = statePath(paths.record)

  // 2. collision / changed-input checks against an existing state
  if (existsSync(sp)) {
    const prev = FileStateStore.load(sp).get()
    if (prev.input.requestSha256 !== valid.requestSha256) {
      const prevLead = prev.input.crm?.leadId
      const newLead = req.crm?.leadId
      if (prevLead !== undefined && newLead !== undefined && prevLead !== newLead) {
        throw new CwError('SLUG_TAKEN', `slug "${req.slug}" is already provisioned for CRM lead ${prevLead}; this request is lead ${newLead}`, { hint: HINTS.SLUG_TAKEN! })
      }
      throw new CwError('INPUT_CHANGED', `clients/${req.slug} was provisioned from a different request (sha ${prev.input.requestSha256.slice(0, 12)}…, now ${valid.requestSha256.slice(0, 12)}…)`, {
        step: 'input',
        hint: HINTS.INPUT_CHANGED!,
      })
    }
  }

  const rt = runtime(cfg, paths, io, hooks)
  const runIdForLock = existsSync(sp) ? FileStateStore.load(sp).get().runId : newRunId()
  return withLock(paths.record, runIdForLock, io, async () => {
    // 3. state: create or resume
    let state: FileStateStore
    const secretValues = () => rt.redactor.known()
    if (existsSync(sp)) {
      state = FileStateStore.load(sp, { secretValues })
      for (const id of state.crashedOnLoad) io.stderr(`step ${id} was running when the last run died; marked failed (CRASHED)\n`)
      const want = { site: port(v['site-port'], '--site-port'), backend: port(v['backend-port'], '--backend-port') }
      if (want.site !== undefined || want.backend !== undefined) {
        const p = await allocatePorts({ cfg, slug: req.slug, want: { ...(want.site ? { site: want.site } : {}), ...(want.backend ? { backend: want.backend } : {}) } })
        state.update((s) => {
          s.ports = { site: p.site, backend: p.backend }
        })
      }
    } else {
      const want = { site: port(v['site-port'], '--site-port'), backend: port(v['backend-port'], '--backend-port') }
      const ports = await allocatePorts({ cfg, slug: req.slug, want: { ...(want.site ? { site: want.site } : {}), ...(want.backend ? { backend: want.backend } : {}) } })
      state = FileStateStore.create(
        sp,
        {
          runId: runIdForLock,
          slug: req.slug,
          mode: 'local',
          input: {
            source,
            ...(inputPath ? { path: inputPath } : {}),
            // recorded whether or not a CRM is configured: SLUG_TAKEN compares lead ids
            ...(leadId !== undefined || req.crm
              ? {
                  crm: {
                    url: cfg.crm?.url ?? req.crm?.url ?? '',
                    ...((leadId ?? req.crm?.leadId) !== undefined ? { leadId: (leadId ?? req.crm?.leadId)! } : {}),
                    ...(req.crm?.siteId ? { siteId: req.crm.siteId } : {}),
                  },
                }
              : {}),
            requestSha256: valid.requestSha256,
            provisioningSha256: valid.provisioningSha256,
          },
          paths,
          ports: { site: ports.site, backend: ports.backend },
          db: { name: dbName(req.slug, cfg.dbPrefix), host: cfg.postgres.host, port: cfg.postgres.port, createdByRun: null },
        },
        { secretValues },
      )
    }

    // 4. steps
    const steps = await requireSteps(cfg, io.env)
    const ctx = buildCtx(rt, state, req, paths)
    ctx.log.info('run start', { runId: state.get().runId, toolVersion: TOOL_VERSION, resume: state.get().createdAt !== state.get().updatedAt })
    const report = await runSteps(steps, ctx)

    // 5. CRM: best effort, never fails the run
    let crm: FlushResult
    try {
      crm = await flush(rt, state, req)
    } catch (e) {
      crm = { crm: 'pending', sent: 0, pending: state.get().crmOutbox.filter((x) => !x.sent).length, error: (e as Error).message }
    }
    const s = state.get()
    const out: Record<string, Json> = {
      ok: report.ok,
      slug: s.slug,
      runId: s.runId,
      statePath: sp,
      urls: urls(s),
      outcomes: summary(report),
      ran: report.ran,
      crm: crm as unknown as Json,
    }
    if (report.failed) {
      Object.assign(out, {
        code: report.failed.code,
        step: report.failed.step,
        message: rt.redactor.redact(report.failed.message),
        hint: report.failed.hint ?? HINTS[report.failed.code] ?? null,
        log: ctx.log.stepLog(report.failed.step),
      })
    }
    return { out, code: report.exitCode }
  })
}

function cmdStatus(slug: string, cfg: Config) {
  const store = loadState(cfg, slug)
  const s = store.get()
  const steps = STEP_IDS.map((id) => {
    const st = s.steps[id]
    return { id, status: st?.status ?? 'pending', attempts: st?.attempts ?? 0, ...(st?.stale ? { stale: true } : {}), ...(st?.error ? { error: st.error as unknown as Json } : {}) }
  })
  const counts: Record<string, number> = {}
  for (const x of steps) counts[x.status] = (counts[x.status] ?? 0) + 1
  const next =
    STEP_IDS.find((id) => {
      const st = s.steps[id]?.status ?? 'pending'
      return (OUTWARD_STEP_IDS as readonly string[]).includes(id) ? st !== 'planned' : !['done', 'skipped'].includes(st)
    }) ?? null
  const failed = steps.filter((x) => x.status === 'failed')
  const last = failed.length ? s.steps[failed[failed.length - 1]!.id as StepId] : undefined
  const procs = new NodeProcessManager({ assertAllowed: () => {} })
  const proc = (p: CwState['processes']['backend']) => (p ? { pid: p.pid, port: p.port, alive: procs.isAlive(p.pid), log: p.log } : null)
  return {
    code: EXIT.OK,
    out: {
      ok: true,
      slug: s.slug,
      runId: s.runId,
      statePath: store.path,
      updatedAt: s.updatedAt,
      input: s.input as unknown as Json,
      ports: s.ports,
      urls: urls(s),
      db: (s.db ?? null) as unknown as Json,
      counts,
      complete: next === null,
      next,
      lastError: last?.error
        ? { step: failed[failed.length - 1]!.id, ...(last.error as unknown as Record<string, Json>), hint: HINTS[last.error.code] ?? null }
        : null,
      processes: { backend: proc(s.processes.backend), site: proc(s.processes.site) },
      crm: { pending: s.crmOutbox.filter((x) => !x.sent).length, sent: s.crmOutbox.filter((x) => x.sent).length },
      verify: s.verify as unknown as Json,
      steps: steps as unknown as Json,
    } as Record<string, Json>,
  }
}

async function cmdVerify(slug: string, io: Io, cfg: Config, hooks: TestHooks | undefined) {
  const paths = clientPaths(cfg, slug)
  const rt = runtime(cfg, paths, io, hooks)
  const state = loadState(cfg, slug, () => rt.redactor.known())
  const steps = await requireSteps(cfg, io.env)
  return withLock(paths.record, state.get().runId, io, async () => {
    const ctx = buildCtx(rt, state, storedRequest(paths.record), paths)
    const report = await runSteps(steps, ctx, { only: ['verify'] })
    const s = state.get()
    return {
      code: report.exitCode,
      out: {
        ok: report.ok && s.verify.every((c) => c.ok),
        slug,
        verify: s.verify as unknown as Json,
        ...(report.failed ? { code: report.failed.code, step: 'verify', message: rt.redactor.redact(report.failed.message), hint: report.failed.hint ?? HINTS.STEP_FAILED! } : {}),
      } as Record<string, Json>,
    }
  })
}

async function cmdStop(slug: string, io: Io, cfg: Config) {
  const paths = clientPaths(cfg, slug)
  const state = loadState(cfg, slug)
  const procs = new NodeProcessManager({ assertAllowed: () => {} })
  return withLock(paths.record, state.get().runId, io, async () => {
    const stopped: Record<string, Json> = {}
    for (const name of ['backend', 'site'] as const) {
      const p = state.get().processes[name]
      if (!p) {
        stopped[name] = 'not running'
        continue
      }
      const alive = procs.isAlive(p.pid)
      if (alive) await procs.stop(p.pid)
      stopped[name] = alive ? `stopped pid ${p.pid}` : `pid ${p.pid} was already gone`
      state.update((s) => {
        s.processes[name] = null
      })
    }
    return { code: EXIT.OK, out: { ok: true, slug, stopped } }
  })
}

async function cmdReportCrm(slug: string, io: Io, cfg: Config) {
  const paths = clientPaths(cfg, slug)
  const rt = runtime(cfg, paths, io, undefined)
  const state = loadState(cfg, slug, () => rt.redactor.known())
  return withLock(paths.record, state.get().runId, io, async () => {
    let siteId = state.get().input.crm?.siteId
    if (siteId === undefined) {
      try {
        siteId = storedRequest(paths.record).crm?.siteId
      } catch {
        /* no stored request */
      }
    }
    const r = await flushOutbox(state, rt.crm, siteId)
    return { code: EXIT.OK, out: { ok: true, slug, ...(r as unknown as Record<string, Json>) } }
  })
}

async function cmdCopy(sub: string | undefined, slug: string, io: Io, cfg: Config) {
  if (sub !== 'init' && sub !== 'validate') throw new CwError('INVALID_INPUT', 'cw copy init|validate <slug>')
  const paths = clientPaths(cfg, slug)
  let mod: { runCopyCommand?: (o: { sub: 'init' | 'validate'; slug: string; cfg: Config; paths: Ctx['paths']; request: ProvisioningRequest }) => Promise<Record<string, Json>> }
  try {
    mod = (await import(new URL('./copy/cli.js', import.meta.url).href)) as typeof mod
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      throw new CwError('PRECONDITION', 'starter-copy support (src/copy/cli.ts) is not in this checkout yet', { hint: 'It lands with CW-WP6.' })
    }
    throw e
  }
  if (typeof mod.runCopyCommand !== 'function') throw new Error('src/copy/cli.ts must export runCopyCommand')
  const out = await mod.runCopyCommand({ sub, slug, cfg, paths, request: storedRequest(paths.record) })
  void io
  return { code: EXIT.OK, out: { ok: true, slug, ...out } }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

export async function secretsCheck(cfg: Config, slug: string, exec: NodeExec, secrets: FileSecretStore): Promise<{ ok: boolean; scanned: number; hits: LeakHit[] }> {
  const paths = clientPaths(cfg, slug)
  const files = new Set<string>()
  for (const repo of [paths.record, paths.backend, paths.site]) {
    if (!existsSync(join(repo, '.git'))) continue
    const r = await exec.run(['git', 'ls-files', '-z'], { cwd: repo, allowFailure: true })
    for (const f of r.stdout.split('\0').filter(Boolean)) files.add(join(repo, f))
  }
  for (const f of walk(join(paths.record, 'logs'))) files.add(f)
  for (const f of ['create-website.state.json', 'outward-plan.md', 'outward-plan.json']) {
    if (existsSync(join(paths.record, f))) files.add(join(paths.record, f))
  }
  const contents: Array<{ path: string; content: string }> = []
  for (const f of files) {
    try {
      if (statSync(f).size > 5_000_000) continue
      contents.push({ path: relative(cfg.clientsDir, f), content: readFileSync(f, 'utf8') })
    } catch {
      /* unreadable / vanished */
    }
  }
  const hits = scanForLeaks(contents, namedSecrets(secrets))
  return { ok: hits.length === 0, scanned: contents.length, hits }
}

async function cmdSecretsCheck(slug: string, io: Io, cfg: Config) {
  const paths = clientPaths(cfg, slug)
  const rt = runtime(cfg, paths, io, undefined)
  // the scanner itself must be able to read raw git output: a fresh, empty redactor for its git calls
  const exec = new NodeExec({ redactor: new Redactor() })
  const r = await secretsCheck(cfg, slug, exec, rt.secrets)
  return {
    code: r.ok ? EXIT.OK : EXIT.STEP_FAILED,
    out: {
      ok: r.ok,
      slug,
      scanned: r.scanned,
      hits: r.hits as unknown as Json,
      ...(r.ok ? {} : { code: 'STEP_FAILED', step: 'verify', message: `${r.hits.length} secret leak(s) found`, hint: 'Rotate the leaked secrets and purge them from history before anything is pushed.' }),
    } as Record<string, Json>,
  }
}

function cmdShowLogin(slug: string, cfg: Config) {
  const s = loadState(cfg, slug).get()
  let email: string | null = null
  try {
    email = storedRequest(s.paths.record).contact.email
  } catch {
    email = null
  }
  return {
    code: EXIT.OK,
    out: {
      ok: true,
      slug,
      site: urls(s).site,
      admin: urls(s).admin,
      realtorEmail: email,
      credentialsFile: join(s.paths.backend, '.admin-credentials.local'),
      credentialKeys: { realtor: ['CLIENT_EMAIL', 'CLIENT_PASSWORD'], platformAdmin: ['MAKLERI_ADMIN_EMAIL', 'MAKLERI_ADMIN_PASSWORD'] },
      note: 'Passwords are never printed. Open the credentials file yourself (it is 0600 and git-ignored).',
    },
  }
}

async function cmdTeardown(slug: string, v: Values, io: Io, cfg: Config) {
  if (!v.yes || v['confirm-slug'] !== slug) {
    throw new CwError('INVALID_INPUT', `teardown needs --yes --confirm-slug ${slug}`, { hint: 'Only when Josef asked for a teardown in this conversation.' })
  }
  const paths = clientPaths(cfg, slug)
  const root = resolve(cfg.clientsDir) + sep
  for (const p of Object.values(paths)) {
    if (!resolve(p).startsWith(root)) throw new CwError('PRECONDITION', `refusing to delete ${p}: outside clientsDir ${cfg.clientsDir}`)
  }
  const rt = runtime(cfg, paths, io, undefined)
  const state = loadState(cfg, slug)
  const s = state.get()
  const doneOutward = OUTWARD_STEP_IDS.filter((id) => s.steps[id]?.status === 'done')
  if (doneOutward.length) throw new CwError('OUTWARD_REFUSED', `outward steps already done (${doneOutward.join(', ')}); local teardown would orphan production resources`)
  for (const repo of [paths.record, paths.backend, paths.site]) {
    if (!existsSync(join(repo, '.git'))) continue
    const r = await rt.exec.run(['git', 'remote'], { cwd: repo, allowFailure: true })
    if (r.stdout.trim()) throw new CwError('PRECONDITION', `${repo} has a git remote (${r.stdout.trim().split('\n').join(', ')}); refusing to delete it`)
  }
  return withLock(paths.record, s.runId, io, async () => {
    const done: string[] = []
    const procs = new NodeProcessManager(rt.exec)
    for (const name of ['backend', 'site'] as const) {
      const p = s.processes[name]
      if (p && procs.isAlive(p.pid)) {
        await procs.stop(p.pid)
        done.push(`stopped ${name} pid ${p.pid}`)
      }
    }
    if (s.db?.createdByRun) {
      await new PgLocalPostgres(cfg).dropDatabase(s.db.name)
      done.push(`dropped database ${s.db.name}`)
    } else if (s.db) {
      done.push(`kept database ${s.db.name} (not created by this tool)`)
    }
    for (const p of [paths.site, paths.backend]) {
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true })
        done.push(`removed ${p}`)
      }
    }
    // the record dir goes last; the lock file in it goes with it
    rmSync(paths.record, { recursive: true, force: true })
    done.push(`removed ${paths.record}`)
    releasePorts(cfg.clientsDir, slug)
    done.push('released ports')
    return { code: EXIT.OK, out: { ok: true, slug, done, realClientsDir: isRealClientsDir(cfg.clientsDir) } }
  })
}

// ---------------------------------------------------------------------------

export async function main(argv: string[], partial: Partial<Io> = {}): Promise<number> {
  const io: Io = {
    stdout: partial.stdout ?? ((s) => process.stdout.write(s)),
    stderr: partial.stderr ?? ((s) => process.stderr.write(s)),
    cwd: partial.cwd ?? process.cwd(),
    env: partial.env ?? process.env,
  }
  // --json is both a flag and the bare-JSON input option: `--json <file>` takes a value
  const args = [...argv]
  let jsonFile: string | undefined
  let jsonOut = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-') && /\.json$/i.test(next)) {
        jsonFile = next
        args.splice(i, 2)
      } else {
        jsonOut = true
        args.splice(i, 1)
      }
      i--
    }
  }
  let statePathForError: string | null = null
  // secret-pipe is refused before option parsing: every form the outward plan
  // prints (`<slug> <file> <key>`, `--write … [--from-file p --delete-source]`,
  // `--generate …`) must give the same clear refusal, not an option error
  if (args.find((a) => !a.startsWith('-')) === 'secret-pipe') {
    const o = {
      ok: false,
      code: 'OUTWARD_REFUSED',
      step: null,
      message: 'cw secret-pipe is a documented placeholder for production steps; it refuses in local mode (OUTWARD_ENABLED=false)',
      hint: 'Outward steps are plan-only in this phase; the lead runs them by hand from outward-plan.md.',
      statePath: null,
    }
    io.stdout((jsonOut ? JSON.stringify(o) : JSON.stringify(o, null, 2)) + '\n')
    return EXIT.OUTWARD_REFUSED
  }
  const print = (o: Record<string, Json>) => io.stdout((jsonOut ? JSON.stringify(o) : JSON.stringify(o, null, 2)) + '\n')
  try {
    const parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true })
    const v = parsed.values as Values & { json?: string }
    if (jsonFile !== undefined) (v as Record<string, unknown>).json = jsonFile
    const [cmd, ...pos] = parsed.positionals
    if (v.help || !cmd || cmd === 'help') {
      io.stdout(HELP)
      return cmd || v.help ? EXIT.OK : EXIT.INVALID_INPUT
    }
    if (cmd === 'slugify') {
      const name = pos.join(' ')
      if (!name) throw new CwError('INVALID_INPUT', 'cw slugify <brand name>')
      const slug = slugifyCzech(name)
      print({ ok: true, name, slug, reserved: (RESERVED_SLUGS as readonly string[]).includes(slug) })
      return EXIT.OK
    }
    const cfg = loadConfig({ cwd: io.cwd, ...(v.config ? { configPath: v.config } : {}), env: io.env })
    const hooks = createTestHooks(cfg, { env: io.env })
    if (pos[0] && /^[a-z0-9-]+$/.test(pos[0])) statePathForError = statePath(clientPaths(cfg, pos[0]).record)

    let r: { out: Record<string, Json>; code: ExitCode }
    switch (cmd) {
      case 'validate':
        r = await cmdValidate(v, io, cfg)
        break
      case 'plan':
        r = await cmdPlan(v, io, cfg)
        break
      case 'run':
        r = await cmdRun(v, pos[0], io, cfg, hooks)
        break
      case 'status':
        r = cmdStatus(requireSlug(pos[0], cmd), cfg)
        break
      case 'verify':
        r = await cmdVerify(requireSlug(pos[0], cmd), io, cfg, hooks)
        break
      case 'stop':
        r = await cmdStop(requireSlug(pos[0], cmd), io, cfg)
        break
      case 'report-crm':
        r = await cmdReportCrm(requireSlug(pos[0], cmd), io, cfg)
        break
      case 'copy':
        statePathForError = pos[1] ? statePath(clientPaths(cfg, pos[1]).record) : null
        r = await cmdCopy(pos[0], requireSlug(pos[1], 'copy'), io, cfg)
        break
      case 'secrets-check':
        r = await cmdSecretsCheck(requireSlug(pos[0], cmd), io, cfg)
        break
      case 'show-login':
        r = cmdShowLogin(requireSlug(pos[0], cmd), cfg)
        break
      case 'teardown':
        r = await cmdTeardown(requireSlug(pos[0], cmd), v, io, cfg)
        break
      default:
        throw new CwError('INVALID_INPUT', `unknown command "${cmd}" (cw --help)`)
    }
    print(r.out)
    return r.code
  } catch (e) {
    const err =
      e instanceof CwError
        ? e
        : (e as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')
          ? new CwError('INVALID_INPUT', (e as Error).message, { hint: 'cw --help' })
          : new CwError('STEP_FAILED', (e as Error)?.stack ?? String(e))
    const r = new Redactor()
    print({
      ok: false,
      code: err.code,
      step: (err.step && isStepId(err.step) ? err.step : null) as Json,
      message: r.redact(err.message),
      hint: err.hint ?? HINTS[err.code] ?? null,
      statePath: statePathForError,
      ...(err.details !== undefined ? { details: err.details } : {}),
    })
    return err.exitCode
  }
}

// catalog is imported so `cw` fails fast (exit 1 at load) if the theme registry cannot load
void catalog

const invokedDirectly = process.argv[1] && /cli\.(ts|js|mjs)$/.test(process.argv[1])
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (e) => {
      process.stderr.write(`cw: ${(e as Error).message}\n`)
      process.exitCode = 1
    },
  )
}
