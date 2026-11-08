/**
 * Shared harness for the /create-website e2e suites (design §B "Integration").
 *
 * Isolation: every suite gets its own temp root `$TMPDIR/cw-e2e-<rand>/` holding
 * `create-website.config.json` (clientsDir inside it, `dbPrefix: cwtest_<rand>_`,
 * its own slice of site 4170–4189 / backend 4270–4289, `testMode: true`) and runs
 * the real CLI (`bin/cw`) with that root as cwd. Nothing outside the root, the
 * `cwtest_<rand>_*` databases and the suite's ports is touched.
 *
 * Inputs from the environment:
 * - CW_E2E_CMS_REPO / CW_E2E_CMS_REF: the cms template (a worktree pinned to the
 *   M1–M4 merge commit); default the sibling Makleri/cms at `main`
 * - CW_E2E_REAL_CRM=1: (reserved) run against a real crm on 4303 instead of the fake
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PLATFORM = resolve(TOOL_DIR, '..', '..')
export const CW_BIN = join(TOOL_DIR, 'bin', 'cw')
export const FIXTURES = join(TOOL_DIR, 'fixtures', 'requests')
export const EVAL_TOOLS = join(PLATFORM, '.claude', 'skills', 'create-website', 'eval-tools')
export const RESERVED_PORTS = [3000, 3001, 3003, 3004, 3017, 3027, 3029]

/** The real Makleri/clients (read-only for the golden diff). */
export const REAL_CLIENTS = [join(PLATFORM, '..', 'clients'), join(PLATFORM, '..', '..', 'clients')].find((p) =>
  existsSync(join(p, 'site-novak-test')),
)

export function cmsRepo(): string {
  if (process.env.CW_E2E_CMS_REPO) return resolve(process.env.CW_E2E_CMS_REPO)
  const guess = [join(PLATFORM, '..', 'cms'), join(PLATFORM, '..', '..', 'cms')].find((p) => existsSync(join(p, 'package.json')))
  if (!guess) throw new Error('set CW_E2E_CMS_REPO to the cms template worktree')
  return guess
}

export const e2eEnabled = process.env.CW_E2E === '1' || process.argv.some((a) => a.includes('e2e'))

export interface Root {
  dir: string
  rand: string
  dbPrefix: string
  clients: string
  ports: { site: [number, number]; backend: [number, number] }
  crmPort?: number
  crm?: ChildProcess
}

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

export function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? (r.signal === 'SIGKILL' ? 137 : 1), signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export function makeRoot(o: { site: [number, number]; backend: [number, number]; crmPort?: number; extra?: Record<string, unknown> }): Root {
  const rand = randomBytes(3).toString('hex')
  const dir = join(realpathSync(tmpdir()), `cw-e2e-${rand}`)
  const clients = join(dir, 'clients')
  mkdirSync(clients, { recursive: true })
  const dbPrefix = `cwtest_${rand}_`
  const cfg = {
    clientsDir: './clients',
    platformRepo: PLATFORM,
    cmsRepo: cmsRepo(),
    cmsRef: process.env.CW_E2E_CMS_REF ?? 'main',
    postgres: { host: 'localhost', port: 5432 },
    dbPrefix,
    ports: { site: o.site, backend: o.backend, reserved: RESERVED_PORTS },
    ...(o.crmPort ? { crm: { url: `http://127.0.0.1:${o.crmPort}`, apiKeyFile: './.fake-crm/api-key' } } : {}),
    subdomainBase: 'realvista.cz',
    testMode: true,
    ...o.extra,
  }
  writeFileSync(join(dir, 'create-website.config.json'), JSON.stringify(cfg, null, 2) + '\n')
  return { dir, rand, dbPrefix, clients, ports: { site: o.site, backend: o.backend }, crmPort: o.crmPort }
}

/**
 * Start eval-tools/fake-crm.mjs for this root. `leads`/`sites` as in the fake's
 * data file; `fixture` names are read from fixtures/requests.
 */
export async function startFakeCrm(root: Root, data: { leads: Record<string, { status: number; fixture?: string; body?: unknown }>; sites: Record<string, unknown> }) {
  if (!root.crmPort) throw new Error('root has no crmPort')
  const leads: Record<string, { status: number; body: unknown }> = {}
  for (const [id, l] of Object.entries(data.leads)) {
    leads[id] = { status: l.status, body: l.fixture ? JSON.parse(readFileSync(join(FIXTURES, l.fixture), 'utf8')) : l.body }
  }
  const dataPath = join(root.dir, '.fake-crm.json')
  writeFileSync(dataPath, JSON.stringify({ apiKey: `cwtest-key-${root.rand}`, leads, sites: data.sites }, null, 2))
  root.crm = spawn(process.execPath, [join(EVAL_TOOLS, 'fake-crm.mjs'), '--port', String(root.crmPort), '--data', dataPath, '--dir', join(root.dir, '.fake-crm')], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${root.crmPort}/__health`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`fake CRM did not start on ${root.crmPort}`)
}

export async function crmLog(root: Root): Promise<{ requests: { method: string; path: string; status: number }[]; provisioningLog: { key: string; step: string; status: string }[] }> {
  return (await (await fetch(`http://127.0.0.1:${root.crmPort}/__log`)).json()) as never
}

export interface CwResult {
  code: number
  json: Record<string, any> | null
  stdout: string
  stderr: string
}

/** Run the real CLI with `--json` in the root. Extra env (e.g. CW_TEST_HOOKS) per call. */
export function cw(root: Root, args: string[], env: Record<string, string> = {}, timeoutMs = 1_800_000): CwResult {
  const base = { ...process.env }
  for (const k of ['CW_TEST_HOOKS', 'CW_FAIL_AT', 'CW_CRASH_AT', 'CW_CONFIG']) delete base[k]
  const r = sh(CW_BIN, [...args, '--json'], { cwd: root.dir, env: { ...base, ...env }, timeoutMs })
  let json: Record<string, any> | null = null
  const last = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop()
  try {
    json = last ? JSON.parse(last) : null
  } catch {}
  return { code: r.code, json, stdout: r.stdout, stderr: r.stderr }
}

export function explain(r: CwResult): string {
  return `exit ${r.code}\nstdout: ${r.stdout.slice(-3000)}\nstderr: ${r.stderr.slice(-3000)}`
}

export function state(root: Root, slug: string): any {
  return JSON.parse(readFileSync(join(root.clients, slug, 'create-website.state.json'), 'utf8'))
}

export function psql(db: string, q: string): string[] {
  const r = sh('psql', ['-h', 'localhost', '-d', db, '-AtX', '-F', '\t', '-c', q], { timeoutMs: 30_000 })
  if (r.code !== 0) throw new Error(`psql ${db}: ${r.stderr}`)
  return r.stdout.split('\n').filter(Boolean)
}

export function databases(root: Root): string[] {
  const like = root.dbPrefix.replace(/_/g, '\\_') + '%'
  return psql('postgres', `select datname from pg_database where datname like '${like}' order by 1`)
}

export function tenantsAndUsers(dbName: string) {
  const tenants = psql(dbName, 'select slug from tenants order by id')
  const users = psql(dbName, 'select email, platform_role from users order by id').map((l) => {
    const [email, role] = l.split('\t')
    return { email: email!, role: role! }
  })
  return { tenants, users }
}

export function git(dir: string, args: string[]): string {
  const r = sh('git', ['-C', dir, ...args])
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} in ${dir}: ${r.stderr}`)
  return r.stdout
}

/** Commits oldest first: subject + Create-Website-* trailers. */
export function commits(dir: string): { subject: string; trailers: Record<string, string[]> }[] {
  const raw = git(dir, ['log', '--reverse', '--format=%s%x1f%B%x1e'])
  return raw.split('\x1e').map((c) => c.trim()).filter(Boolean).map((c) => {
    const [subject, body] = c.split('\x1f') as [string, string]
    const trailers: Record<string, string[]> = {}
    for (const m of (body ?? '').matchAll(/^(Create-Website-[A-Za-z-]+):\s*(.+)$/gm)) (trailers[m[1]!] ??= []).push(m[2]!.trim())
    return { subject, trailers }
  })
}

/** Every Create-Website-Step / -Template trailer value appears in exactly one commit. */
export function duplicateTrailers(dir: string): string[] {
  const seen = new Map<string, number>()
  for (const c of commits(dir)) for (const [k, vs] of Object.entries(c.trailers)) for (const v of vs) seen.set(`${k}: ${v}`, (seen.get(`${k}: ${v}`) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`)
}

export function fileSha(p: string): string | null {
  return existsSync(p) ? sha256(readFileSync(p)) : null
}

export function envKeyHash(p: string, key: string): string | null {
  if (!existsSync(p)) return null
  const m = readFileSync(p, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? sha256(m[1]!.replace(/^['"]|['"]$/g, '')) : null
}

export function mode(p: string): string {
  return (statSync(p).mode & 0o777).toString(8)
}

export async function get(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init })
  return { status: res.status, headers: res.headers, text: await res.text() }
}

export function sectionsOf(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/data-section="([^"]+)"/g)) if (!out.includes(m[1]!)) out.push(m[1]!)
  return out
}

export function variantOf(html: string): string | null {
  return html.match(/<html[^>]*\sdata-variant="([^"]+)"/)?.[1] ?? null
}

export const OUTWARD = ['github-repos', 'postgres-hosting', 'vercel-projects', 'vercel-env', 'fallback-domains', 'deploy-hook', 'client-dns', 'dependabot-enable', 'go-live'] as const

/** Local steps that are not done must be in `allowSkipped`; outward steps must be planned. */
export function incompleteSteps(st: any, allowSkipped: string[] = []): string[] {
  const bad: string[] = []
  for (const [id, s] of Object.entries<any>(st.steps)) {
    if ((OUTWARD as readonly string[]).includes(id)) {
      if (s.status !== 'planned') bad.push(`${id}=${s.status}`)
    } else if (!(s.status === 'done' || (s.status === 'skipped' && allowSkipped.includes(id)))) bad.push(`${id}=${s.status}`)
  }
  return bad
}

/** Teardown via eval-tools/teardown.mjs (cw stop, port sweep, DB drop with the cwtest_ prefix, rm -rf). */
export async function destroyRoot(root: Root | undefined, keep = process.env.CW_E2E_KEEP === '1') {
  if (!root) return
  try {
    root.crm?.kill('SIGTERM')
  } catch {}
  const mod = (await import(join(EVAL_TOOLS, 'teardown.mjs'))) as { teardownRun: (d: string, o: { keep?: boolean; platform?: string }) => unknown }
  mod.teardownRun(root.dir, { keep, platform: PLATFORM })
}
