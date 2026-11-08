/**
 * Exec (A5): every child process the engine starts goes through here.
 *
 * The guard runs before anything is spawned, in every mode, and refuses:
 * - the outward CLIs (gh, vercel, neonctl, doctl), directly, through
 *   npx/pnpm dlx/pnpm exec, or inside a `sh -c` script;
 * - any argument naming a provider API host (api.vercel.com, api.github.com, …);
 * - anything about nameservers (`nameserver`, `ns1.`): the client's DNS is
 *   A/CNAME records only, their nameservers and MX stay untouched;
 * - any argument containing a known secret value (secrets go via env/stdin).
 *
 * Child stdout/stderr is redacted before it is returned, logged or shown.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { Redactor } from './redact.js'
import { isSecretEnvKey } from './secrets.js'
import { CwError, type Exec, type ExecOptions, type ExecResult } from './types.js'

export const FORBIDDEN_BINARIES = ['gh', 'vercel', 'neonctl', 'doctl', 'wrangler', 'flyctl'] as const

export const FORBIDDEN_HOSTS = [
  'api.vercel.com',
  'vercel.com/api',
  'api.github.com',
  'uploads.github.com',
  'console.neon.tech',
  'api.neon.tech',
  'api.digitalocean.com',
  'api.wedos.com',
  'api.cloudflare.com',
] as const

const NAMESERVER_RE = /nameservers?|name-servers?|(^|[^a-z0-9])ns\d+\./i
const LAUNCHERS = new Set(['npx', 'bunx', 'pnpx'])
const SUBCOMMAND_LAUNCHERS: Record<string, Set<string>> = {
  pnpm: new Set(['dlx', 'exec', 'x']),
  yarn: new Set(['dlx', 'exec']),
  npm: new Set(['exec', 'x']),
}
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish'])
const FORBIDDEN_WORD_RE = new RegExp(`(^|[\\s;&|(\`/'"])(${FORBIDDEN_BINARIES.join('|')})(?=$|[\\s;&|)\`'"])`)

function refuse(reason: string, argv: string[]): never {
  // the message never echoes argv verbatim: it may hold a secret
  throw new CwError('EXEC_REFUSED', `refused to run ${basename(argv[0] ?? '?')}: ${reason}`, {
    hint: 'Outward steps (GitHub, Vercel, hosted Postgres, DNS) are plan-only in local mode; see outward-plan.md.',
  })
}

/** Throws CwError EXEC_REFUSED; pure, so callers and tests can use it without spawning. */
export function assertAllowedArgv(argv: string[], secretValues: Iterable<string> = []): void {
  if (argv.length === 0 || !argv[0]) refuse('empty command', argv)
  const bin = basename(argv[0])
  if ((FORBIDDEN_BINARIES as readonly string[]).includes(bin)) refuse(`${bin} is an outward CLI`, argv)

  // npx vercel / pnpm dlx vercel / pnpm exec gh …
  const firstNonFlag = (from: number) => argv.slice(from).find((a) => !a.startsWith('-'))
  let launched: string | undefined
  if (LAUNCHERS.has(bin)) launched = firstNonFlag(1)
  else if (SUBCOMMAND_LAUNCHERS[bin]?.has(argv[1] ?? '')) launched = firstNonFlag(2)
  if (launched) {
    const name = basename(launched.replace(/@[^/]*$/, ''))
    if ((FORBIDDEN_BINARIES as readonly string[]).includes(name)) refuse(`${name} is an outward CLI`, argv)
  }

  // sh -c "… vercel …"
  if (SHELLS.has(bin) || bin === 'env' || bin === 'xargs') {
    for (const a of argv.slice(1)) if (FORBIDDEN_WORD_RE.test(a)) refuse('outward CLI inside a shell command', argv)
  }

  for (const a of argv) {
    const lower = a.toLowerCase()
    for (const h of FORBIDDEN_HOSTS) if (lower.includes(h)) refuse(`argument names a provider API (${h})`, argv)
    if (NAMESERVER_RE.test(a)) refuse('nameserver changes are never made by this tool', argv)
  }

  for (const v of secretValues) {
    if (v && v.length >= 8 && argv.some((a) => a.includes(v))) refuse('a secret value appears on the command line', argv)
  }
}

/** Minimal env for children: enough to find node/pnpm/git, nothing from our own secrets. */
function baseEnv(): Record<string, string> {
  const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'PNPM_HOME', 'NVM_DIR', 'COREPACK_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']
  const out: Record<string, string> = {}
  for (const k of keep) {
    const v = process.env[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

export interface NodeExecOptions {
  redactor: Redactor
  /** called with every redacted chunk, e.g. to mirror to a console in verbose mode */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void
}

export class NodeExec implements Exec {
  constructor(private readonly o: NodeExecOptions) {}

  assertAllowed(argv: string[]): void {
    assertAllowedArgv(argv, this.o.redactor.known())
  }

  async run(argv: string[], opts: ExecOptions): Promise<ExecResult> {
    // only secret-classified keys (and everything in secretEnv) are registered:
    // PORT, TENANT_SLUG or a URL must stay usable on argv and readable in logs
    for (const [k, v] of Object.entries(opts.env ?? {})) if (isSecretEnvKey(k)) this.o.redactor.add(v)
    for (const v of Object.values(opts.secretEnv ?? {})) this.o.redactor.add(v)
    this.assertAllowed(argv)
    const extra = { ...(opts.env ?? {}), ...(opts.secretEnv ?? {}) }
    const env = opts.cleanEnv ? extra : { ...baseEnv(), ...extra }
    const r = this.o.redactor
    const log = (s: string) => {
      if (!opts.logFile) return
      mkdirSync(dirname(opts.logFile), { recursive: true })
      appendFileSync(opts.logFile, s, { mode: 0o600 })
    }
    log(`\n$ ${r.redact(argv.join(' '))}   (cwd ${opts.cwd})\n`)

    return new Promise((resolve, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd: opts.cwd,
        env,
        stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer =
        opts.timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true
              child.kill('SIGKILL')
            }, opts.timeoutMs)
          : undefined
      child.stdout!.on('data', (b: Buffer) => {
        stdout += b.toString()
      })
      child.stderr!.on('data', (b: Buffer) => {
        stderr += b.toString()
      })
      if (opts.stdin !== undefined) child.stdin!.end(opts.stdin)
      child.on('error', (e) => {
        if (timer) clearTimeout(timer)
        reject(
          new CwError('STEP_FAILED', `could not start ${basename(argv[0]!)}: ${(e as NodeJS.ErrnoException).code ?? e.message}`, {
            cause: e,
          }),
        )
      })
      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer)
        const out = r.redact(stdout)
        const err = r.redact(stderr)
        log(out)
        if (err) log(err)
        this.o.onOutput?.(out, 'stdout')
        if (err) this.o.onOutput?.(err, 'stderr')
        const exit = code ?? (signal ? 128 : 1)
        log(`[exit ${exit}${signal ? ` ${signal}` : ''}${timedOut ? ' timeout' : ''}]\n`)
        if (exit !== 0 && !opts.allowFailure) {
          const tail = (err || out).trim().split('\n').slice(-15).join('\n')
          reject(
            new CwError('STEP_FAILED', `${basename(argv[0]!)} ${argv[1] ?? ''} exited ${exit}${timedOut ? ' (timeout)' : ''}\n${tail}`.trim()),
          )
          return
        }
        resolve({ code: exit, stdout: out, stderr: err })
      })
    })
  }
}
