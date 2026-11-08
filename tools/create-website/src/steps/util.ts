/**
 * Shared helpers for step modules: fingerprints, git trailers, commits that
 * refuse to include secret files, small file probes.
 *
 * Everything that touches the world goes through `ctx.exec` (git) or plain
 * fs reads, so unit tests can run against a real temp dir with a fake Exec.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { Ctx, Json, StepId } from '../types.js'
import { CwError } from '../types.js'

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Stable JSON (sorted keys) so a fingerprint does not depend on key order. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`
}

export function fingerprintOf(parts: Record<string, unknown>): string {
  return `sha256:${sha256(stableJson(parts))}`
}

export function fileSha(path: string): string | null {
  return existsSync(path) ? sha256(readFileSync(path)) : null
}

export function isNonEmptyDir(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0
  } catch {
    return false
  }
}

/** Trailer every step commit carries, so probes can find "our" commits. */
export const STEP_TRAILER = 'Create-Website-Step'
export const TEMPLATE_TRAILER = 'Create-Website-Template'
export const RUN_TRAILER = 'Create-Website-Run'

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

/** All trailer values for `key` across the repo's history (empty when no repo/commits). */
export async function trailerValues(ctx: Ctx, dir: string, key: string): Promise<string[]> {
  if (!isGitRepo(dir)) return []
  const r = await ctx.exec.run(
    ['git', 'log', `--format=%(trailers:key=${key},valueonly,separator=%x00)`],
    { cwd: dir, allowFailure: true },
  )
  if (r.code !== 0) return []
  return r.stdout
    .split(/[\n\0]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function hasStepCommit(ctx: Ctx, dir: string, step: StepId): Promise<boolean> {
  return (await trailerValues(ctx, dir, STEP_TRAILER)).includes(step)
}

/** The template trailer of the repo's FIRST commit, or null. */
export async function rootTemplateTrailer(ctx: Ctx, dir: string): Promise<string | null> {
  if (!isGitRepo(dir)) return null
  const roots = await ctx.exec.run(['git', 'rev-list', '--max-parents=0', 'HEAD'], {
    cwd: dir,
    allowFailure: true,
  })
  const root = roots.stdout.trim().split('\n')[0]
  if (roots.code !== 0 || !root) return null
  const r = await ctx.exec.run(
    ['git', 'log', '-1', `--format=%(trailers:key=${TEMPLATE_TRAILER},valueonly)`, root],
    { cwd: dir, allowFailure: true },
  )
  return r.stdout.trim() || null
}

export async function headCommit(ctx: Ctx, dir: string): Promise<string | null> {
  const r = await ctx.exec.run(['git', 'rev-parse', 'HEAD'], { cwd: dir, allowFailure: true })
  return r.code === 0 ? r.stdout.trim() : null
}

/**
 * Commit everything in `dir` with step + run trailers. Before staging, every
 * secret-file name must be git-ignored in this repo (A5): a secret that slips
 * into a client repo is pushed with it later.
 */
export async function commitAll(
  ctx: Ctx,
  dir: string,
  subject: string,
  o: { step: StepId; body?: string; trailers?: Record<string, string>; allowEmpty?: boolean },
): Promise<string | null> {
  await assertSecretsIgnored(ctx, dir)
  await ctx.exec.run(['git', 'add', '-A'], { cwd: dir })
  const staged = await ctx.exec.run(['git', 'diff', '--cached', '--quiet'], { cwd: dir, allowFailure: true })
  if (staged.code === 0 && !o.allowEmpty) return null
  const trailers = { [STEP_TRAILER]: o.step, [RUN_TRAILER]: ctx.state.get().runId, ...o.trailers }
  const msg = [subject, '', ...(o.body ? [o.body, ''] : []), ...Object.entries(trailers).map(([k, v]) => `${k}: ${v}`)].join('\n')
  await ctx.exec.run(['git', 'commit', '-q', ...(o.allowEmpty ? ['--allow-empty'] : []), '-F', '-'], {
    cwd: dir,
    stdin: msg,
    env: gitIdentityEnv(),
  })
  return headCommit(ctx, dir)
}

/** Author identity for tool commits when the machine has none configured. */
export function gitIdentityEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  if (!process.env.GIT_AUTHOR_NAME) env.GIT_AUTHOR_NAME = 'REALVISTA create-website'
  if (!process.env.GIT_AUTHOR_EMAIL) env.GIT_AUTHOR_EMAIL = 'create-website@realvista.invalid'
  if (!process.env.GIT_COMMITTER_NAME) env.GIT_COMMITTER_NAME = env.GIT_AUTHOR_NAME ?? 'REALVISTA create-website'
  if (!process.env.GIT_COMMITTER_EMAIL) env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL ?? 'create-website@realvista.invalid'
  return env
}

const NAMES_TO_IGNORE = ['.env', '.env.local', '.admin-credentials.local']

export async function assertSecretsIgnored(ctx: Ctx, dir: string): Promise<void> {
  if (!isGitRepo(dir)) return
  for (const name of NAMES_TO_IGNORE) {
    const r = await ctx.exec.run(['git', 'check-ignore', '-q', '--no-index', name], { cwd: dir, allowFailure: true })
    if (r.code !== 0) {
      throw new CwError('PRECONDITION', `${name} is not git-ignored in ${dir}; refusing to commit`, {
        hint: 'The template .gitignore must cover every secret file before the first commit.',
      })
    }
  }
}

export async function gitInit(ctx: Ctx, dir: string): Promise<void> {
  if (isGitRepo(dir)) return
  await ctx.exec.run(['git', 'init', '-q', '-b', 'main'], { cwd: dir })
}

/** `KEY=value` lines (no quoting rules beyond stripping matching quotes). For NON-secret files only. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    let v = m[2]!
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]!] = v
  }
  return out
}

/** `KEY=value` lines printed by the cms seed scripts (TENANT_ID=…, CLIENT_USER_ID=…). */
export function parseKv(stdout: string, key: string): string | undefined {
  const m = new RegExp(`^${key}=(.+)$`, 'm').exec(stdout)
  return m?.[1]?.trim()
}

/** GET returning a status, or 0 when nothing answers. Never throws. */
export async function httpStatus(ctx: Ctx, url: string, headers?: Record<string, string>): Promise<number> {
  try {
    const r = await ctx.http.request({ url, headers, timeoutMs: 5000, redirect: 'manual' })
    return r.status
  } catch {
    return 0
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function outputs(o: Record<string, Json | undefined>): Record<string, Json> {
  const r: Record<string, Json> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v
  return r
}

export function backendUrl(ctx: Ctx): string {
  return `http://localhost:${ctx.state.get().ports.backend}`
}

export function siteUrlLocal(ctx: Ctx): string {
  return `http://localhost:${ctx.state.get().ports.site}`
}

/** Canonical site URL in local mode: the fallback `https://<slug>.<base>` (A6). */
export function canonicalSiteUrl(ctx: Ctx): string {
  return `https://${ctx.request.slug}.${ctx.cfg.subdomainBase}`
}

/**
 * True when re-running would only redo finished work: the probe says the
 * world is complete and the inputs did not change since the step last
 * succeeded (or it never ran itself, e.g. the exporter already made the
 * standalone commit). The runner calls run() whenever state is not `done`,
 * so run() uses this to stay idempotent.
 */
export async function upToDate(ctx: Ctx, step: { id: StepId; probe(ctx: Ctx): Promise<{ state: string }>; fingerprint(ctx: Ctx): string }): Promise<boolean> {
  if ((await step.probe(ctx)).state !== 'done') return false
  const prev = ctx.state.step(step.id).fingerprint
  return prev === undefined || prev === step.fingerprint(ctx)
}
