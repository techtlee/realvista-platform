/**
 * Outward adapters: the production steps (runbook 13–19) as plans.
 *
 * In this phase nothing outward runs. Each adapter's `plan()` describes the
 * exact commands for Josef to run by hand, and `apply()` throws
 * `OutwardDisabledError` while `OUTWARD_ENABLED` is false. The step modules
 * (WP6) call `plan()` for the outward step ids and mark them `planned`; the
 * `outward-plan` step renders every plan into `clients/<slug>/outward-plan.md`.
 *
 * The plan only ever *references* secrets. Production secrets are never the
 * local dev values (the runbook: "regenerate, don't reuse dev ones"), so the
 * only files a plan can name are the two production files below, which both
 * templates already git-ignore through `.env*.local`.
 */
import type { OutwardStepId, PlannedCommand } from '../types.js'
import type { DnsRecord } from './dns.js'

/** Production secret files, by logical id. Local dev files are deliberately not nameable here. */
export const PRODUCTION_SECRET_FILES = ['backend/.env.production.local', 'site/.env.production.local'] as const
export type ProductionSecretFile = (typeof PRODUCTION_SECRET_FILES)[number]

/** Placeholders the lead replaces: the GitHub org/user and the Vercel team slug (runbook Phase E). */
export const OWNER = 'OWNER'
export const TEAM = 'TEAM'

/** Where a command runs: a client directory, or the directory holding create-website.config.json. */
export type CommandDir = 'root' | 'record' | 'backend' | 'site'

/** What a command reads on stdin. Secrets by reference only; `value` is for non-secret literals. */
export type StdinSource =
  | { kind: 'secret'; file: ProductionSecretFile; key: string }
  /** a shell variable the lead has from an earlier command's output (e.g. TENANT_ID), never a secret */
  | { kind: 'shell-var'; name: string }
  | { kind: 'value'; value: string }

export interface OutwardCommand {
  id: string
  description: string
  cwd: CommandDir
  argv: string[]
  /** non-secret environment, rendered inline as NAME=value */
  env?: Record<string, string>
  /** production secret files sourced into the command's environment (never printed) */
  envFrom?: ProductionSecretFile[]
  stdin?: StdinSource
  /** stdout (optionally through a jq filter) is stored as a secret, never shown */
  captureTo?: { file: ProductionSecretFile; key: string; jq?: string }
  /** a read-only check; when it succeeds the command is skipped (`probe || command`) */
  idempotencyProbe?: string[]
  note?: string
}

export interface OutwardPlan {
  step: OutwardStepId
  title: string
  /** runbook step, e.g. "13" */
  runbook: string
  summary: string
  commands: OutwardCommand[]
  /** human instructions (for the lead or for the client); never executable */
  instructions: string[]
  /** DNS records for a human to add (client-dns); A and CNAME only, by type */
  records?: readonly DnsRecord[]
  /** set when the step is not needed at all, with the reason */
  notNeeded?: string
}

/** The non-secret facts every outward plan is computed from. */
export interface OutwardInput {
  slug: string
  owner: string
  team: string
  subdomainBase: string
  repos: { backend: string; site: string }
  /** display paths, relative to the directory holding create-website.config.json */
  dirs: { record: string; backend: string; site: string }
  fallback: { site: string; admin: string }
  domain: {
    situation: 'have-access' | 'have-no-access' | 'none'
    name?: string
    registrar?: string
    emailOnDomain: 'yes' | 'no' | 'unknown'
  }
  contact: { name: string; email: string }
  /** file names inside `dirs.record` */
  requestFile: string
}

export interface OutwardAdapter {
  readonly step: OutwardStepId
  readonly title: string
  readonly runbook: string
  /** never executes anything */
  plan(input: OutwardInput): OutwardPlan
  /** always throws OutwardDisabledError in this phase */
  apply(input: OutwardInput): Promise<never>
}

export type { PlannedCommand }
