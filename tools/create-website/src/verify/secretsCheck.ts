/**
 * `cw secrets-check` (A5): no known secret value, nor any 12-character piece
 * of one, may appear in a git-tracked file of the three repos, in the run
 * logs, the state file or the outward plan. Reports locations and the secret's
 * KEY NAME only, never the value.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { Ctx, SecretFileId } from '../types.js'

export const SUBSTRING_LEN = 12
const SECRET_FILES: SecretFileId[] = [
  'backend/.env',
  'backend/.admin-credentials.local',
  'site/.env.local',
  'backend/.env.production.local',
  'site/.env.production.local',
]
const MAX_FILE_BYTES = 5 * 1024 * 1024

export interface SecretHit {
  file: string
  key: string
  kind: 'value' | 'substring'
}

export interface SecretsCheckResult {
  ok: boolean
  scannedFiles: number
  secretsKnown: number
  hits: SecretHit[]
}

/** One secret to look for: the whole value always; 12-char pieces only of `pieces`. */
export interface KnownSecret {
  value: string
  key: string
  /** the part whose fragments would leak something (the password of a URL); null = whole-value match only */
  pieces: string | null
}

/**
 * A connection URL is mostly public (scheme, host, port, DB name all appear in
 * .env.example, the state and the README); only its password is secret. A
 * passwordless local URL therefore has no fragments worth flagging.
 */
export function secretParts(value: string, key: string): KnownSecret {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const u = new URL(value)
      const pw = decodeURIComponent(u.password)
      return { value, key, pieces: pw.length >= 8 ? pw : null }
    } catch {
      /* not a URL after all */
    }
  }
  return { value, key, pieces: value }
}

/** Secret-classified values, read in-process from the secret files (values never leave this process). */
export async function knownSecrets(ctx: Ctx): Promise<KnownSecret[]> {
  const out = new Map<string, KnownSecret>()
  for (const f of SECRET_FILES) {
    if (!existsSync(ctx.secrets.pathOf(f))) continue
    for (const key of await ctx.secrets.keys(f)) {
      const v = await ctx.secrets.get({ file: f, key })
      // Only values the store itself treats as secret (it ignores ports, slugs, e-mails…).
      if (v && ctx.secrets.knownValues().includes(v)) out.set(v, secretParts(v, `${f}:${key}`))
    }
  }
  for (const v of ctx.secrets.knownValues()) if (!out.has(v)) out.set(v, secretParts(v, '(registered)'))
  return [...out.values()]
}

export class SecretScanner {
  private readonly whole: Array<[string, string]>
  private readonly pieces = new Map<string, string>()

  constructor(secrets: KnownSecret[] | Map<string, string>) {
    const list = secrets instanceof Map ? [...secrets.entries()].map(([v, key]) => secretParts(v, key)) : secrets
    this.whole = list.filter((s) => s.value.length >= 8).map((s) => [s.value, s.key])
    for (const s of list) {
      if (!s.pieces) continue
      for (let i = 0; i + SUBSTRING_LEN <= s.pieces.length; i++) this.pieces.set(s.pieces.slice(i, i + SUBSTRING_LEN), s.key)
    }
  }

  scan(text: string): Array<{ key: string; kind: 'value' | 'substring' }> {
    const hits: Array<{ key: string; kind: 'value' | 'substring' }> = []
    for (const [v, key] of this.whole) if (text.includes(v)) hits.push({ key, kind: 'value' })
    if (hits.length) return hits
    if (this.pieces.size) {
      for (let i = 0; i + SUBSTRING_LEN <= text.length; i++) {
        const key = this.pieces.get(text.slice(i, i + SUBSTRING_LEN))
        if (key) return [{ key, kind: 'substring' }]
      }
    }
    return hits
  }
}

async function trackedFiles(ctx: Ctx, repo: string): Promise<string[]> {
  if (!existsSync(join(repo, '.git'))) return []
  const r = await ctx.exec.run(['git', 'ls-files', '-z'], { cwd: repo, allowFailure: true })
  if (r.code !== 0) return []
  return r.stdout.split('\0').filter(Boolean).map((f) => join(repo, f))
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (st.isFile()) out.push(p)
  }
  return out
}

/**
 * Secret files ever committed, anywhere in a repo's history. (A content scan
 * of history through Exec would be useless: child output is redacted before
 * we see it, which hides exactly the values we are looking for. HEAD content
 * is scanned from disk instead.)
 */
const SECRET_FILE_NAMES = new Set(['.env', '.env.local', '.admin-credentials.local', '.env.production.local'])
async function committedSecretFiles(ctx: Ctx, repo: string): Promise<string[]> {
  if (!existsSync(join(repo, '.git'))) return []
  const r = await ctx.exec.run(['git', 'log', '--all', '--format=', '--name-only'], { cwd: repo, allowFailure: true })
  if (r.code !== 0) return []
  return [...new Set(r.stdout.split('\n').map((l) => l.trim()).filter((l) => SECRET_FILE_NAMES.has(l.split('/').pop() ?? '')))]
}

export async function secretsCheck(ctx: Ctx): Promise<SecretsCheckResult> {
  const secrets = await knownSecrets(ctx)
  const scanner = new SecretScanner(secrets)
  const files = new Set<string>()
  for (const repo of [ctx.paths.record, ctx.paths.backend, ctx.paths.site]) for (const f of await trackedFiles(ctx, repo)) files.add(f)
  for (const f of walk(join(ctx.paths.record, 'logs'))) files.add(f)
  for (const name of ['create-website.state.json', 'outward-plan.md', 'outward-plan.json']) {
    const p = join(ctx.paths.record, name)
    if (existsSync(p)) files.add(p)
  }
  const hits: SecretHit[] = []
  let scanned = 0
  const rel = (p: string) => relative(ctx.cfg.clientsDir, p) || p
  for (const f of files) {
    if (!existsSync(f)) continue
    const st = statSync(f)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue
    scanned++
    for (const h of scanner.scan(readFileSync(f, 'utf8'))) hits.push({ file: rel(f), ...h })
  }
  // The record repo and the two client repos get pushed later: check their whole history, not just HEAD.
  for (const repo of [ctx.paths.record, ctx.paths.backend, ctx.paths.site]) {
    for (const f of await committedSecretFiles(ctx, repo)) hits.push({ file: `${rel(join(repo, f))} (in git history)`, key: f, kind: 'value' })
  }
  return { ok: hits.length === 0, scannedFiles: scanned, secretsKnown: secrets.length, hits }
}
