/**
 * A fake world for step tests: a real temp dir (real git, real files, the
 * real SecretStore), with pnpm, Postgres, HTTP and processes faked and every
 * command recorded.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertAllowedArgv } from '../../../src/exec.js'
import { Redactor } from '../../../src/redact.js'
import { FileSecretStore } from '../../../src/secrets.js'
import type {
  Config,
  Ctx,
  CwState,
  Exec,
  ExecOptions,
  ExecResult,
  Http,
  HttpRequest,
  HttpResponse,
  LocalPostgres,
  ProcessManager,
  ProvisioningRequest,
  RunLogger,
  StateStore,
  StepId,
  StepState,
} from '../../../src/types.js'

export const REQUEST: ProvisioningRequest = {
  requestVersion: 1,
  slug: 'svoboda-reality',
  contact: { name: 'Petra Svobodová', email: 'petra@svoboda-reality.example', phone: '+420 600 000 222' },
  company: { name: 'Svoboda Reality s.r.o.', city: 'Brno' },
  provisioning: {
    schemaVersion: 1,
    theme: { name: 'realvista', variant: 'indigo' },
    modules: { blog: true, services: false, listingMap: true, mortgageCalculator: true, references: false },
    sections: { home: ['hero', 'agent', 'featured', 'stats', 'services', 'blog', 'contact'] },
    brand: { name: 'Svoboda Reality', tagline: 'Bydlení v Brně s klidem' },
    content: { tone: 'friendly', locale: 'cs-CZ' },
    domain: { situation: 'none', emailOnDomain: 'unknown' },
    plan: { tier: 'standard', billingPeriod: 'yearly' },
  } as unknown as ProvisioningRequest['provisioning'],
}

export interface Call {
  argv: string[]
  cwd: string
  env: Record<string, string>
}

export type Handler = (argv: string[], opts: ExecOptions) => ExecResult | undefined | Promise<ExecResult | undefined>

/** Runs git/tar for real (fast, local), fakes everything else through handlers. */
export class FakeExec implements Exec {
  calls: Call[] = []
  handlers: Handler[] = []
  constructor(private readonly redactor: Redactor) {}
  assertAllowed(argv: string[]): void {
    assertAllowedArgv(argv, this.redactor.known())
  }
  async run(argv: string[], opts: ExecOptions): Promise<ExecResult> {
    this.assertAllowed(argv)
    this.calls.push({ argv, cwd: opts.cwd, env: { ...(opts.env ?? {}) } })
    for (const h of this.handlers) {
      const r = await h(argv, opts)
      if (r) return this.finish(r, opts)
    }
    if (argv[0] === 'git' || argv[0] === 'tar') {
      const r = spawnSync(argv[0], argv.slice(1), {
        cwd: opts.cwd,
        input: opts.stdin,
        env: { ...process.env, ...(opts.env ?? {}), GIT_CONFIG_NOSYSTEM: '1' },
        encoding: 'utf8',
      })
      return this.finish({ code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }, opts)
    }
    return this.finish({ code: 0, stdout: '', stderr: '' }, opts)
  }
  private finish(r: ExecResult, opts: ExecOptions): ExecResult {
    if (r.code !== 0 && !opts.allowFailure) throw new Error(`command failed (${r.code}): ${r.stderr}`)
    return r
  }
  ran(pred: (a: string[]) => boolean): Call[] {
    return this.calls.filter((c) => pred(c.argv))
  }
}

export class FakePg implements LocalPostgres {
  dbs = new Set<string>()
  created: string[] = []
  async ping() {}
  async databaseExists(n: string) {
    return this.dbs.has(n)
  }
  async createDatabase(n: string) {
    if (this.dbs.has(n)) throw new Error('exists')
    this.dbs.add(n)
    this.created.push(n)
  }
  async dropDatabase(n: string) {
    this.dbs.delete(n)
  }
  async listDatabases(p: string) {
    return [...this.dbs].filter((d) => d.startsWith(p))
  }
  url(n: string) {
    return `postgres://cw:pw-not-a-real-one@localhost:5432/${n}`
  }
}

export class FakeHttp implements Http {
  requests: HttpRequest[] = []
  routes: Array<(r: HttpRequest) => HttpResponse | undefined> = []
  async request(r: HttpRequest): Promise<HttpResponse> {
    this.requests.push(r)
    for (const route of this.routes) {
      const res = route(r)
      if (res) return res
    }
    throw new Error(`ECONNREFUSED ${r.url}`)
  }
}

export class FakeProcs implements ProcessManager {
  alive = new Set<number>()
  busyPorts = new Map<number, number>()
  next = 5000
  started: Array<{ name: string; argv: string[]; port: number }> = []
  async startDetached(o: { name: string; argv: string[]; port: number }) {
    const pid = this.next++
    this.alive.add(pid)
    this.busyPorts.set(o.port, pid)
    this.started.push({ name: o.name, argv: o.argv, port: o.port })
    return { pid }
  }
  isAlive(pid: number) {
    return this.alive.has(pid)
  }
  async stop(pid: number) {
    this.alive.delete(pid)
    for (const [p, x] of this.busyPorts) if (x === pid) this.busyPorts.delete(p)
  }
  async pidOnPort(port: number) {
    return this.busyPorts.get(port) ?? null
  }
  async isPortFree(port: number) {
    return !this.busyPorts.has(port)
  }
}

export class MemState implements StateStore {
  path: string
  private s: CwState
  constructor(path: string, init: CwState) {
    this.path = path
    this.s = init
  }
  get() {
    return this.s
  }
  update(m: (s: CwState) => void) {
    const c = structuredClone(this.s)
    m(c)
    this.s = c
    return this.s
  }
  step(id: StepId): StepState {
    return this.s.steps[id] ?? { status: 'pending', attempts: 0 }
  }
  patchStep(id: StepId, p: Partial<StepState>): StepState {
    this.update((s) => {
      s.steps[id] = { ...(s.steps[id] ?? { status: 'pending', attempts: 0 }), ...p }
    })
    return this.step(id)
  }
}

export interface World {
  root: string
  ctx: Ctx
  exec: FakeExec
  pg: FakePg
  http: FakeHttp
  procs: FakeProcs
  secrets: FileSecretStore
  state: MemState
  cleanup(): void
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  })
}

/** A tiny cms "template" repo with a manifest and a .gitignore covering the secret files. */
export function makeCmsRepo(dir: string): string {
  mkdirSync(join(dir, 'src', 'seed'), { recursive: true })
  writeFileSync(join(dir, '.gitignore'), '.env\n.env*.local\n.admin-credentials.local\nnode_modules/\n')
  writeFileSync(join(dir, 'package.json'), '{"name":"cms","scripts":{}}\n')
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  writeFileSync(
    join(dir, 'realvista-template.json'),
    JSON.stringify({ template: 'realvista-client-backend', templateApiVersion: 1, scripts: ['migrate', 'seed:admin', 'seed:client-site', 'seed:client', 'seed:site-key', 'dev', 'start'] }),
  )
  writeFileSync(join(dir, 'README.md'), '# Payload blank\n')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'template')
  return git(dir, 'rev-parse', 'HEAD').trim()
}

export function makeWorld(o: { request?: ProvisioningRequest } = {}): World {
  const root = mkdtempSync(join(tmpdir(), 'cw6-unit-'))
  const clientsDir = join(root, 'clients')
  mkdirSync(clientsDir)
  const request = o.request ?? REQUEST
  const paths = {
    record: join(clientsDir, request.slug),
    backend: join(clientsDir, `backend-${request.slug}`),
    site: join(clientsDir, `site-${request.slug}`),
  }
  const cfg: Config = {
    configPath: join(root, 'create-website.config.json'),
    rootDir: root,
    clientsDir,
    platformRepo: join(root, 'platform'),
    cmsRepo: join(root, 'cms'),
    cmsRef: 'main',
    postgres: { host: 'localhost', port: 5432 },
    dbPrefix: 'cw6_',
    ports: { site: [4160, 4169], backend: [4260, 4269], reserved: [3000, 3001, 3003] },
    subdomainBase: 'realvista.cz',
    testMode: true,
  }
  const redactor = new Redactor()
  const secrets = new FileSecretStore({ backend: paths.backend, site: paths.site }, redactor)
  const state = new MemState(join(paths.record, 'create-website.state.json'), {
    stateVersion: 1,
    toolVersion: '0.1.0',
    runId: 'cw-20261108T120000Z-test',
    slug: request.slug,
    mode: 'local',
    createdAt: 'x',
    updatedAt: 'x',
    input: { source: 'file', requestSha256: 'a', provisioningSha256: 'b' },
    templates: {},
    paths,
    ports: { site: 4161, backend: 4261 },
    secrets: {},
    steps: {},
    processes: { backend: null, site: null },
    verify: [],
    crmOutbox: [],
  })
  const exec = new FakeExec(redactor)
  const pg = new FakePg()
  const http = new FakeHttp()
  const procs = new FakeProcs()
  const logDir = join(paths.record, 'logs', 'run')
  const log: RunLogger = {
    dir: logDir,
    info() {},
    warn() {},
    error() {},
    stepLog: (s) => join(logDir, `${s}.log`),
  }
  const ctx: Ctx = { cfg, state, exec, secrets, pg, procs, http, log, request, paths }
  return { root, ctx, exec, pg, http, procs, secrets, state, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export const ok = (status = 200, text = '', headers: Record<string, string> = {}): HttpResponse => ({ status, text, headers })
