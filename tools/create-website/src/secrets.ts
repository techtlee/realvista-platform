/**
 * SecretStore (A5): the only code that reads or writes secret files.
 *
 * - `ensure` never overwrites an existing value; credentials and
 *   PAYLOAD_SECRET survive every resume.
 * - Writes are atomic and 0600: temp file in the same directory (created
 *   0600, fchmod'd again in case of umask oddities), fsync, rename.
 * - Values are generated in-process with crypto.randomBytes, never by a
 *   shell command (which would put them on argv).
 * - Every value read or written is registered with the Redactor, so logs,
 *   child output and the exec guard know it.
 */
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

import { Redactor } from './redact.js'
import { OUTWARD_ENABLED, OutwardDisabledError, type Exec, type LocalSecretFileId, type SecretFileId, type SecretRef, type SecretStore } from './types.js'

export const SECRET_FILE_IDS: readonly LocalSecretFileId[] = [
  'backend/.env',
  'backend/.admin-credentials.local',
  'site/.env.local',
]

export const SECRET_FILE_MODE = 0o600

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Secret files also hold public values (ports, the slug, e-mails, URLs).
 * Registering those with the Redactor would make the exec guard refuse every
 * path under clients/backend-<slug> and blank the slug out of logs, so values
 * are classified by KEY. Fail-closed: in a secret file, a key that is in
 * neither list is treated as secret (and a warning names the key).
 */
export const SECRET_KEY_RE = /(KEY|SECRET|PASSWORD|PASS|TOKEN|DATABASE_URL|PRIVATE|CREDENTIAL)/i

export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'DATABASE_URL',
  'PAYLOAD_SECRET',
  'MAKLERI_ADMIN_PASSWORD',
  'CLIENT_PASSWORD',
  'REVALIDATE_SECRET',
  'CMS_API_KEY',
  'CW_CRM_API_KEY',
  'CW_CRM_EMAIL', // CW3 contract: both provisioner key-file entries are secret-classified
  'CRM_ADMIN_PASSWORD',
  'CRM_STAFF_PASSWORD',
])

export const NON_SECRET_KEYS: ReadonlySet<string> = new Set([
  'PORT',
  'NODE_ENV',
  'PLATFORM_SUBDOMAIN_BASE',
  'TENANT_SLUG',
  'TENANT_ID',
  'CLIENT_EMAIL',
  'CLIENT_NAME',
  'CLIENT_PHONE',
  'MAKLERI_ADMIN_EMAIL',
  'NEXT_PUBLIC_CMS_URL',
  'NEXT_PUBLIC_SITE_URL',
  'SITE_URL',
  'SERVER_URL',
  'CMS_URL',
  'CMS_PROBE_URL',
  'CRM_ADMIN_EMAIL',
  'CRM_STAFF_EMAIL',
  'NEXT_TELEMETRY_DISABLED',
  'CI',
  // file locations handed to cms scripts (values are paths under clients/<slug>/)
  'PROVISIONING_REQUEST',
  'PROVISIONING_JSON',
  'STARTER_COPY_JSON',
  'SITE_KEY_OUT',
  'PROVISIONER_KEY_OUT',
])

export type KeyClass = 'secret' | 'public' | 'unknown'

/**
 * Keys whose value is a LOCATION, not a secret: `SITE_KEY_OUT` names the
 * 0600 file the key is written to, `PROVISIONING_REQUEST` a JSON file. Their
 * values are paths under clients/<slug>/; registering them would redact the
 * slug's paths and make the exec guard refuse them.
 */
export const PATH_KEY_RE = /_(OUT|FILE|PATH|DIR)$/

export function classifyKey(key: string): KeyClass {
  if (SECRET_KEYS.has(key)) return 'secret'
  if (NON_SECRET_KEYS.has(key)) return 'public'
  if (PATH_KEY_RE.test(key)) return 'public'
  if (SECRET_KEY_RE.test(key)) return 'secret'
  return 'unknown'
}

/** Inside a secret file: unknown keys are secret (fail-closed). */
export function isSecretFileKey(key: string): boolean {
  return classifyKey(key) !== 'public'
}

/** In a child env: only keys classified secret are registered (unknown = an ordinary env var). */
export function isSecretEnvKey(key: string): boolean {
  return classifyKey(key) === 'secret'
}

export interface DotenvLine {
  key?: string
  value?: string
  raw: string
}

export function parseDotenv(text: string): DotenvLine[] {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((raw) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw)
    if (!m) return { raw }
    let value = m[2]!.trim()
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    return { key: m[1]!, value, raw }
  })
}

export function dotenvToRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of parseDotenv(text)) if (l.key !== undefined) out[l.key] = l.value ?? ''
  return out
}

function formatValue(v: string): string {
  if (/[\s#"'\\$`]/.test(v)) {
    if (v.includes('"') || v.includes('\n')) throw new Error('secret values must not contain quotes or newlines')
    return `"${v}"`
  }
  return v
}

/** Atomic 0600 write: temp file in the same dir, fsync, rename over the target. */
export function writeFileAtomic0600(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  const fd = openSync(tmp, 'wx', SECRET_FILE_MODE)
  try {
    fchmodSync(fd, SECRET_FILE_MODE)
    writeSync(fd, content)
    fsyncSync(fd)
  } catch (e) {
    closeSync(fd)
    rmSync(tmp, { force: true })
    throw e
  }
  closeSync(fd)
  renameSync(tmp, path)
}

export function fileMode(path: string): number {
  return statSync(path).mode & 0o777
}

export class FileSecretStore implements SecretStore {
  readonly redactor: Redactor

  private warned = new Set<string>()

  constructor(
    private readonly paths: { backend: string; site: string },
    redactor?: Redactor,
    /** called once per unknown key (name only, never the value) */
    private readonly onWarn?: (msg: string) => void,
  ) {
    this.redactor = redactor ?? new Redactor()
  }

  /** Registers a value with the Redactor if its key is secret-classified (unknown → secret, with a warning). */
  private track(file: SecretFileId, key: string, value: string | undefined): void {
    if (!value) return
    const c = classifyKey(key)
    if (c === 'public') return
    if (c === 'unknown' && !this.warned.has(`${file}:${key}`)) {
      this.warned.add(`${file}:${key}`)
      this.onWarn?.(`${file}: key ${key} is not classified; treating its value as secret`)
    }
    this.redactor.add(value)
  }

  pathOf(file: SecretFileId): string {
    switch (file) {
      case 'backend/.env':
        return join(this.paths.backend, '.env')
      case 'backend/.admin-credentials.local':
        return join(this.paths.backend, '.admin-credentials.local')
      case 'site/.env.local':
        return join(this.paths.site, '.env.local')
      case 'backend/.env.production.local':
        return join(this.paths.backend, '.env.production.local')
      case 'site/.env.production.local':
        return join(this.paths.site, '.env.production.local')
      default: {
        const never: never = file
        throw new Error(`unknown secret file ${String(never)}`)
      }
    }
  }

  /** Production secret files are plan references only while outward steps are disabled. */
  private assertLocal(file: SecretFileId): void {
    if (!OUTWARD_ENABLED && file.endsWith('.env.production.local')) throw new OutwardDisabledError(`secret file ${file}`)
  }

  private read(file: SecretFileId): DotenvLine[] {
    this.assertLocal(file)
    const p = this.pathOf(file)
    if (!existsSync(p)) return []
    const lines = parseDotenv(readFileSync(p, 'utf8'))
    for (const l of lines) if (l.key !== undefined) this.track(file, l.key, l.value)
    return lines
  }

  private write(file: SecretFileId, lines: DotenvLine[]): void {
    this.assertLocal(file)
    writeFileAtomic0600(this.pathOf(file), lines.map((l) => l.raw).join('\n') + '\n')
  }

  /** Read all secret files once so their values are known to redaction and the exec guard. */
  preload(): void {
    for (const f of SECRET_FILE_IDS) this.read(f)
  }

  async ensure(file: SecretFileId, key: string, gen: () => string): Promise<{ created: boolean }> {
    assertKey(key)
    const lines = this.read(file)
    const existing = lines.find((l) => l.key === key)
    if (existing && existing.value !== undefined && existing.value !== '') return { created: false }
    const value = gen()
    this.track(file, key, value)
    const line = { key, value, raw: `${key}=${formatValue(value)}` }
    if (existing) lines[lines.indexOf(existing)] = line
    else lines.push(line)
    this.write(file, lines)
    return { created: true }
  }

  async get(ref: SecretRef): Promise<string | undefined> {
    const l = this.read(ref.file).find((x) => x.key === ref.key)
    return l?.value === '' ? undefined : l?.value
  }

  async has(ref: SecretRef): Promise<boolean> {
    return (await this.get(ref)) !== undefined
  }

  async set(ref: SecretRef, value: string): Promise<void> {
    assertKey(ref.key)
    this.track(ref.file, ref.key, value)
    const lines = this.read(ref.file)
    const line = { key: ref.key, value, raw: `${ref.key}=${formatValue(value)}` }
    const i = lines.findIndex((l) => l.key === ref.key)
    if (i >= 0) lines[i] = line
    else lines.push(line)
    this.write(ref.file, lines)
  }

  async keys(file: SecretFileId): Promise<string[]> {
    return this.read(file)
      .filter((l) => l.key !== undefined && l.value !== '')
      .map((l) => l.key!)
  }

  generate(bytes = 32): string {
    return randomBytes(bytes).toString('base64url')
  }

  knownValues(): string[] {
    return this.redactor.known()
  }

  register(value: string): void {
    this.redactor.add(value)
  }
}

function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`invalid env key "${key}"`)
}

// ---------------------------------------------------------------------------
// Leak scan (`cw secrets-check` and the last check of `verify`: ONE
// implementation, so the two can never disagree)

export const SUBSTRING_LEN = 12
const MAX_SCAN_BYTES = 5 * 1024 * 1024

/** One secret to look for. Values never leave the process; hits carry `key` only. */
export interface KnownSecret {
  value: string
  /** `file:KEY` or `(registered)` — what a hit reports */
  key: string
  /** match the whole value (false for a URL whose only secret is absent) */
  matchWhole: boolean
  /** the part whose 12-character pieces count as a leak; null = none */
  pieces: string | null
}

/**
 * What of a value is secret. A connection URL is mostly public (scheme, host,
 * port and DB name appear in .env.example, the state and the README); only
 * its password is secret. A password-less local URL
 * (`postgres://localhost:5432/backend_x_dev`) therefore holds nothing to
 * leak; a URL with a password is matched whole, and pieces come from the
 * password only.
 */
export function secretParts(value: string, key: string): KnownSecret | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const u = new URL(value)
      const pw = decodeURIComponent(u.password)
      if (pw.length < MIN_SECRET_VALUE) return null
      return { value, key, matchWhole: true, pieces: pw.length >= SUBSTRING_LEN ? pw : null }
    } catch {
      /* not a URL after all */
    }
  }
  if (value.length < MIN_SECRET_VALUE) return null
  return { value, key, matchWhole: true, pieces: value.length > SUBSTRING_LEN ? value : null }
}

const MIN_SECRET_VALUE = 8

export interface SecretHit {
  /** path relative to clientsDir */
  file: string
  key: string
  kind: 'value' | 'substring'
}

export class SecretScanner {
  private readonly whole: Array<[string, string]> = []
  private readonly pieces = new Map<string, string>()

  constructor(secrets: KnownSecret[]) {
    for (const s of secrets) {
      if (s.matchWhole) this.whole.push([s.value, s.key])
      if (!s.pieces) continue
      for (let i = 0; i + SUBSTRING_LEN <= s.pieces.length; i++) this.pieces.set(s.pieces.slice(i, i + SUBSTRING_LEN), s.key)
    }
  }

  get size(): number {
    return this.whole.length + this.pieces.size
  }

  /** At most one hit per secret per text: the whole value if present, else a piece. */
  scan(text: string): Array<{ key: string; kind: 'value' | 'substring' }> {
    const hits = new Map<string, 'value' | 'substring'>()
    for (const [v, key] of this.whole) if (text.includes(v)) hits.set(key, 'value')
    if (this.pieces.size) {
      for (let i = 0; i + SUBSTRING_LEN <= text.length; i++) {
        const key = this.pieces.get(text.slice(i, i + SUBSTRING_LEN))
        if (key && !hits.has(key)) hits.set(key, 'substring')
      }
    }
    return [...hits].map(([key, kind]) => ({ key, kind }))
  }
}

/** Pure: scan given contents. */
export function scanForLeaks(files: Array<{ path: string; content: string }>, secrets: KnownSecret[]): SecretHit[] {
  const scanner = new SecretScanner(secrets)
  return files.flatMap((f) => scanner.scan(f.content).map((h) => ({ file: f.path, ...h })))
}

/**
 * Secret-classified values from the three local secret files, plus every
 * value registered with the store's Redactor (e.g. a minted key), as
 * KnownSecrets. Production files are skipped while outward is disabled.
 */
export function knownSecrets(store: FileSecretStore): KnownSecret[] {
  const out = new Map<string, KnownSecret | null>()
  for (const f of SECRET_FILE_IDS) {
    const p = store.pathOf(f)
    if (!existsSync(p)) continue
    for (const l of parseDotenv(readFileSync(p, 'utf8'))) {
      if (l.key !== undefined && l.value && isSecretFileKey(l.key) && !out.has(l.value)) out.set(l.value, secretParts(l.value, `${f}:${l.key}`))
    }
  }
  for (const v of store.knownValues()) if (!out.has(v)) out.set(v, secretParts(v, '(registered)'))
  return [...out.values()].filter((x): x is KnownSecret => x !== null)
}

export interface SecretsCheckResult {
  ok: boolean
  scannedFiles: number
  secretsKnown: number
  hits: SecretHit[]
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

/**
 * The whole check: git-tracked files of the record, backend and site repos,
 * `logs/`, the state file and `outward-plan.*`. Used by `cw secrets-check`
 * and by the `verify` step. `exec` should carry an EMPTY redactor, or the
 * git output it reads would itself be redacted.
 */
export async function runSecretsCheck(o: {
  exec: Pick<Exec, 'run'>
  store: FileSecretStore
  paths: { record: string; backend: string; site: string }
  clientsDir: string
}): Promise<SecretsCheckResult> {
  const files = new Set<string>()
  for (const repo of [o.paths.record, o.paths.backend, o.paths.site]) {
    if (!existsSync(join(repo, '.git'))) continue
    const r = await o.exec.run(['git', 'ls-files', '-z'], { cwd: repo, allowFailure: true })
    if (r.code !== 0) continue
    for (const f of r.stdout.split('\0').filter(Boolean)) files.add(join(repo, f))
  }
  for (const f of walkFiles(join(o.paths.record, 'logs'))) files.add(f)
  for (const f of ['create-website.state.json', 'outward-plan.md', 'outward-plan.json']) {
    if (existsSync(join(o.paths.record, f))) files.add(join(o.paths.record, f))
  }
  const secrets = knownSecrets(o.store)
  const scanner = new SecretScanner(secrets)
  const hits: SecretHit[] = []
  let scannedFiles = 0
  for (const f of files) {
    let content: string
    try {
      if (statSync(f).size > MAX_SCAN_BYTES) continue
      content = readFileSync(f, 'utf8')
    } catch {
      continue // vanished / unreadable
    }
    scannedFiles++
    for (const h of scanner.scan(content)) hits.push({ file: relative(o.clientsDir, f), ...h })
  }
  return { ok: hits.length === 0, scannedFiles, secretsKnown: secrets.length, hits }
}
