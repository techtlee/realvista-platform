import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setBackendQueryFactory } from '../../../src/backend/db.js'
import {
  CREDENTIAL_KEYS,
  backendCopy,
  backendCredentials,
  backendCustomize,
  backendDb,
  backendDbName,
  backendEnv,
  backendMigrate,
  backendSeedContent,
  backendStart,
  readSiteKeyFile,
  siteKey,
} from '../../../src/steps/backend.js'
import { STEP_TRAILER, TEMPLATE_TRAILER } from '../../../src/steps/util.js'
import { git, makeCmsRepo, makeWorld, ok, type World } from './helpers.js'

let w: World
let sha: string

beforeEach(() => {
  w = makeWorld()
  mkdirSync(w.ctx.cfg.cmsRepo)
  sha = makeCmsRepo(w.ctx.cfg.cmsRepo)
  w.state.update((s) => {
    s.templates.cms = { repo: w.ctx.cfg.cmsRepo, commit: sha }
  })
  mkdirSync(w.ctx.paths.record, { recursive: true })
  setBackendQueryFactory(() => async () => [])
})
afterEach(() => w.cleanup())

describe('backend-copy', () => {
  it('copies the pinned commit with a template trailer, and the probe then reports done', async () => {
    expect((await backendCopy.probe(w.ctx)).state).toBe('absent')
    await backendCopy.run(w.ctx)
    expect(existsSync(join(w.ctx.paths.backend, 'realvista-template.json'))).toBe(true)
    const msg = git(w.ctx.paths.backend, 'log', '-1', '--format=%B')
    expect(msg).toContain(`${TEMPLATE_TRAILER}: cms@${sha}`)
    expect(msg).toContain(`${STEP_TRAILER}: backend-copy`)
    expect((await backendCopy.probe(w.ctx)).state).toBe('done')
  })

  it('never includes uncommitted changes of the template checkout', async () => {
    writeFileSync(join(w.ctx.cfg.cmsRepo, 'DIRTY.md'), 'not committed')
    await backendCopy.run(w.ctx)
    expect(existsSync(join(w.ctx.paths.backend, 'DIRTY.md'))).toBe(false)
  })

  it('reports TARGET_EXISTS for a hand-made directory and leaves it untouched', async () => {
    mkdirSync(w.ctx.paths.backend)
    writeFileSync(join(w.ctx.paths.backend, 'mine.txt'), 'hand made')
    const p = await backendCopy.probe(w.ctx)
    expect(p).toMatchObject({ state: 'conflict', code: 'TARGET_EXISTS' })
    expect(readFileSync(join(w.ctx.paths.backend, 'mine.txt'), 'utf8')).toBe('hand made')
  })

  it('a stale re-run reuses our copy instead of copying again', async () => {
    await backendCopy.run(w.ctx)
    const before = git(w.ctx.paths.backend, 'rev-list', '--count', 'HEAD').trim()
    const out = await backendCopy.run(w.ctx)
    expect(out.reused).toBe(true)
    expect(git(w.ctx.paths.backend, 'rev-list', '--count', 'HEAD').trim()).toBe(before)
  })

  it('a half-written temp dir of THIS run is partial; recover removes only it', async () => {
    const clients = w.ctx.cfg.clientsDir
    const mine = join(clients, `.cw-tmp-${w.state.get().runId}-backend`)
    const other = join(clients, '.cw-tmp-cw-other-run-backend')
    mkdirSync(mine)
    mkdirSync(other)
    expect((await backendCopy.probe(w.ctx)).state).toBe('partial')
    await backendCopy.recover!(w.ctx)
    expect(existsSync(mine)).toBe(false)
    expect(existsSync(other)).toBe(true)
  })
})

describe('backend-customize', () => {
  it('commits a client README and dependabot once', async () => {
    await backendCopy.run(w.ctx)
    await backendCustomize.run(w.ctx)
    expect(readFileSync(join(w.ctx.paths.backend, 'README.md'), 'utf8')).toContain('# backend-svoboda-reality')
    expect(existsSync(join(w.ctx.paths.backend, '.github', 'dependabot.yml'))).toBe(true)
    expect((await backendCustomize.probe(w.ctx)).state).toBe('done')
    await backendCustomize.run(w.ctx)
    expect(git(w.ctx.paths.backend, 'log', '--format=%s').split('\n').filter((l) => l.startsWith('Client README')).length).toBe(1)
  })
})

describe('backend-db', () => {
  it('creates the prefixed DB and records that this run owns it', async () => {
    await backendDb.run(w.ctx)
    expect(w.pg.created).toEqual(['cw6_backend_svoboda_reality_dev'])
    expect(w.state.get().db?.createdByRun).toBe(w.state.get().runId)
    expect((await backendDb.probe(w.ctx)).state).toBe('done')
  })

  it('an existing DB not created by this run is a DB_EXISTS conflict (never dropped)', async () => {
    w.pg.dbs.add(backendDbName(w.ctx))
    expect(await backendDb.probe(w.ctx)).toMatchObject({ state: 'conflict', code: 'DB_EXISTS' })
    expect(w.pg.dbs.has(backendDbName(w.ctx))).toBe(true)
  })
})

describe('backend-env and backend-credentials', () => {
  beforeEach(async () => {
    await backendCopy.run(w.ctx)
  })

  it('writes .env 0600 with every key and never overwrites PAYLOAD_SECRET', async () => {
    await backendEnv.run(w.ctx)
    const file = w.secrets.pathOf('backend/.env')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const first = await w.secrets.get({ file: 'backend/.env', key: 'PAYLOAD_SECRET' })
    expect((await backendEnv.probe(w.ctx)).state).toBe('done')
    await backendEnv.run(w.ctx)
    expect(await w.secrets.get({ file: 'backend/.env', key: 'PAYLOAD_SECRET' })).toBe(first)
    expect(await w.secrets.get({ file: 'backend/.env', key: 'PORT' })).toBe('4261')
  })

  it('credentials are generated once; a re-run leaves the file byte-identical', async () => {
    await backendCredentials.run(w.ctx)
    const file = w.secrets.pathOf('backend/.admin-credentials.local')
    const before = readFileSync(file, 'utf8')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    for (const k of CREDENTIAL_KEYS) expect(before).toMatch(new RegExp(`^${k}=`, 'm'))
    expect(before).toContain('CLIENT_EMAIL=petra@svoboda-reality.example')
    await backendCredentials.run(w.ctx)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(backendCredentials.irreversible).toBe(true)
  })

  it('a partial credentials file is completed without touching the existing values', async () => {
    writeFileSync(w.secrets.pathOf('backend/.admin-credentials.local'), 'CLIENT_PASSWORD=keep-this-password-123\n', { mode: 0o600 })
    expect((await backendCredentials.probe(w.ctx)).state).toBe('partial')
    await backendCredentials.run(w.ctx)
    expect(await w.secrets.get({ file: 'backend/.admin-credentials.local', key: 'CLIENT_PASSWORD' })).toBe('keep-this-password-123')
    expect((await backendCredentials.probe(w.ctx)).state).toBe('done')
  })

  it('the secret files are git-ignored in the copy', () => {
    for (const f of ['.env', '.admin-credentials.local']) {
      expect(() => git(w.ctx.paths.backend, 'check-ignore', '-q', '--no-index', f)).not.toThrow()
    }
  })
})

describe('backend-seed-content', () => {
  it('passes paths and secrets through env, never argv, and records TENANT_ID', async () => {
    await backendCopy.run(w.ctx)
    await backendEnv.run(w.ctx)
    await backendCredentials.run(w.ctx)
    w.exec.handlers.push((argv) => (argv.join(' ') === 'pnpm seed:client-site' ? { code: 0, stdout: 'TENANT_ID=7\n# 3 listings', stderr: '' } : undefined))
    await backendSeedContent.run(w.ctx)
    expect(w.state.get().tenantId).toBe(7)
    const call = w.exec.ran((a) => a[1] === 'seed:client-site')[0]!
    expect(call.env.PROVISIONING_REQUEST).toBe(join(w.ctx.paths.record, 'provisioning-request.json'))
    expect(call.env.SITE_URL).toBe('http://localhost:4161')
    expect(call.env.REVALIDATE_SECRET).toBeTruthy()
    for (const v of w.secrets.knownValues()) expect(call.argv.join(' ')).not.toContain(v)
  })
})

describe('backend-start', () => {
  it('starts next dev on the recorded port and reuses a healthy process', async () => {
    await backendCopy.run(w.ctx)
    await backendEnv.run(w.ctx)
    w.http.routes.push((r) => (r.url.startsWith('http://localhost:4261/api/site-settings') ? ok(403) : undefined))
    await backendStart.run(w.ctx)
    expect(w.procs.started[0]!.argv).toEqual(['pnpm', 'exec', 'next', 'dev', '--port', '4261'])
    expect((await backendStart.probe(w.ctx)).state).toBe('done')
    const out = await backendStart.run(w.ctx)
    expect(out.reused).toBe(true)
    expect(w.procs.started).toHaveLength(1)
  })

  it('a port held by someone else is PORT_BUSY', async () => {
    w.procs.busyPorts.set(4261, 999)
    expect(await backendStart.probe(w.ctx)).toMatchObject({ state: 'conflict', code: 'PORT_BUSY' })
  })
})

describe('site-key', () => {
  beforeEach(async () => {
    await backendCopy.run(w.ctx)
    await backendEnv.run(w.ctx)
    await backendCredentials.run(w.ctx)
  })

  const mintHandler = (key: string) => (argv: string[], opts: { env?: Record<string, string> }) => {
    if (argv.join(' ') !== 'pnpm seed:site-key') return undefined
    writeFileSync(opts.env!.SITE_KEY_OUT!, `CMS_API_KEY=${key}\n`, { mode: 0o600 })
    return { code: 0, stdout: 'TENANT_ID=3\n# verified', stderr: '' }
  }

  it('mints through a 0600 file, stores the key, and never sees it on argv or stdout', async () => {
    const key = 'b1946ac9-2f0a-4f8e-9d7e-1f6a1c0d5e77'
    w.exec.handlers.push(mintHandler(key))
    w.http.routes.push((r) => (r.url.includes('/api/site-settings') ? ok(r.headers?.Authorization === `users API-Key ${key}` ? 200 : 403) : undefined))
    expect((await siteKey.probe(w.ctx)).state).toBe('absent')
    await siteKey.run(w.ctx)
    expect(await w.secrets.get({ file: 'backend/.admin-credentials.local', key: 'SITE_CMS_API_KEY' })).toBe(key)
    expect(w.state.get().tenantId).toBe(3)
    const call = w.exec.ran((a) => a[1] === 'seed:site-key')[0]!
    expect(call.env.CMS_PROBE_URL).toBe('http://localhost:4261')
    expect(existsSync(call.env.SITE_KEY_OUT!)).toBe(false)
    expect(JSON.stringify(w.state.get())).not.toContain(key)
    expect((await siteKey.probe(w.ctx)).state).toBe('done')
  })

  it('does not re-mint while the stored key authenticates', async () => {
    const key = 'b1946ac9-2f0a-4f8e-9d7e-1f6a1c0d5e77'
    w.exec.handlers.push(mintHandler(key))
    w.http.routes.push((r) => (r.url.includes('/api/site-settings') ? ok(r.headers?.Authorization === `users API-Key ${key}` ? 200 : 403) : undefined))
    await siteKey.run(w.ctx)
    const minted = w.state.get().siteKey!.mintedAt
    await siteKey.run(w.ctx)
    expect(w.exec.ran((a) => a[1] === 'seed:site-key')).toHaveLength(1)
    expect(w.state.get().siteKey!.mintedAt).toBe(minted)
  })

  it('re-mints only when the stored key stops authenticating', async () => {
    await w.secrets.set({ file: 'backend/.admin-credentials.local', key: 'SITE_CMS_API_KEY' }, 'old-key-that-is-revoked-0000')
    const fresh = 'c2946ac9-2f0a-4f8e-9d7e-1f6a1c0d5e88'
    w.exec.handlers.push(mintHandler(fresh))
    w.http.routes.push((r) => (r.url.includes('/api/site-settings') ? ok(r.headers?.Authorization === `users API-Key ${fresh}` ? 200 : r.headers?.Authorization ? 403 : 403) : undefined))
    expect((await siteKey.probe(w.ctx)).state).toBe('partial')
    await siteKey.run(w.ctx)
    expect(await w.secrets.get({ file: 'backend/.admin-credentials.local', key: 'SITE_CMS_API_KEY' })).toBe(fresh)
  })

  it('reads the M3 key file in both shapes', () => {
    const p = join(w.root, 'k')
    writeFileSync(p, 'CMS_API_KEY=abc-123\n')
    expect(readSiteKeyFile(p)).toBe('abc-123')
    writeFileSync(p, 'abc-456\n')
    expect(readSiteKeyFile(p)).toBe('abc-456')
  })
})

describe('backend-migrate', () => {
  const addMigrations = (...names: string[]) => {
    const dir = join(w.ctx.paths.backend, 'src', 'migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.ts'), 'export const migrations = []\n')
    for (const n of names) writeFileSync(join(dir, `${n}.ts`), '')
  }

  it('is done when every migration file is recorded (dev-push rows ignored), so a resume never re-prompts', async () => {
    addMigrations('20261108_100819_baseline')
    setBackendQueryFactory(() => async () => [{ name: '20261108_100819_baseline' }])
    expect((await backendMigrate.probe(w.ctx)).state).toBe('done')
    await backendMigrate.run(w.ctx)
    expect(w.exec.ran((a) => a[1] === 'migrate')).toHaveLength(0)
  })

  it('a new template migration is partial; the run answers the dev-push prompt with No and fails clearly', async () => {
    await backendCopy.run(w.ctx)
    await backendEnv.run(w.ctx)
    addMigrations('20261108_100819_baseline', '20261201_000000_new')
    setBackendQueryFactory(() => async () => [{ name: '20261108_100819_baseline' }])
    expect((await backendMigrate.probe(w.ctx)).state).toBe('partial')
    w.exec.handlers.push((argv) => (argv.join(' ') === 'pnpm migrate' ? { code: 1, stdout: 'It looks like you have run Payload in dev mode', stderr: '' } : undefined))
    await expect(backendMigrate.run(w.ctx)).rejects.toThrow(/schema-pushed/)
  })
})
