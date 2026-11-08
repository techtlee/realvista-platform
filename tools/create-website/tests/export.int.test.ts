import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadThemeKitFixture, startFakeCms, type FakeCms } from '../fixtures/fake-cms/server.js'
import { exportSite, type ExportReport } from '../src/site/index.js'

/**
 * A6 drift guard: export `apps/site` from this platform commit, then prove the
 * copy builds on its own in a temp dir (`pnpm install && pnpm build`, then
 * `tsc --noEmit`) against a fake CMS serving theme-kit fixtures, and that the
 * served home page has the colourway and the configured section order.
 *
 * Every platform change that breaks the export fails here, not in a client's
 * first build. Ports: fake CMS 4150, the exported site 4151 (WP5's block).
 */

const PLATFORM = path.resolve(import.meta.dirname, '../../..')
const CMS_PORT = 4150
const SITE_PORT = 4151
const API_KEY = 'fake-cms-key-export-int'

const provisioning = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'unit/site/__fixtures__/novak-test.provisioning.json'), 'utf8'),
) as never

let root: string
let site: string
let cms: FakeCms
let report: ExportReport
let server: ReturnType<typeof spawn> | undefined

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
  })

/**
 * The environment a person's shell would give pnpm: without vitest's
 * NODE_ENV=test, under which Next deliberately skips .env.local.
 */
function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NEXT_TELEMETRY_DISABLED: '1', ...extra }
  for (const k of Object.keys(env)) if (k === 'NODE_ENV' || k.startsWith('VITEST') || k === 'TEST') delete env[k]
  return env
}

/**
 * Async on purpose: the fake CMS lives in this process, and a spawnSync would
 * block the event loop it answers on (next build would time out on it).
 */
function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const t0 = Date.now()
  return new Promise<{ status: number | null; out: string }>((resolve) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (out += d.toString()))
    child.on('close', (status) => {
      // Real output in the test log: the acceptance evidence is what pnpm/next printed.
      console.log(`\n$ ${cmd} ${args.join(' ')}   (${cwd}, exit ${status}, ${((Date.now() - t0) / 1000).toFixed(1)}s)\n${out.trim().split('\n').slice(-30).join('\n')}`)
      resolve({ status, out })
    })
  })
}

/** `data-section` values in document order, first occurrence only. */
const sectionOrder = (html: string) => [...new Set([...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]!))]

beforeAll(async () => {
  for (const p of [CMS_PORT, SITE_PORT]) {
    if (!(await portFree(p))) throw new Error(`port ${p} is in use; export.int needs 4150 (fake CMS) and 4151 (site)`)
  }
  cms = await startFakeCms({ data: await loadThemeKitFixture(PLATFORM), port: CMS_PORT, apiKey: API_KEY })
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-export-int-'))
  site = path.join(root, 'site-novak-test')
  report = await exportSite({
    platformRoot: PLATFORM,
    commit: 'HEAD',
    outDir: site,
    request: { requestVersion: 1, slug: 'novak-test', contact: { name: 'Jan Novák', email: 'jan@example.cz' }, provisioning },
    ports: { site: SITE_PORT, backend: CMS_PORT },
    subdomainBase: 'realvista.cz',
    runId: 'export-int',
  })
  // What site-env writes, pointed at the fake CMS. Never committed (.gitignore).
  fs.writeFileSync(
    path.join(site, '.env.local'),
    `NEXT_PUBLIC_CMS_URL=${cms.url}\nTENANT_ID=1\nCMS_API_KEY=${API_KEY}\nREVALIDATE_SECRET=export-int\n`,
    { mode: 0o600 },
  )
})

afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (server.exitCode === null) server.kill('SIGKILL')
  }
  await cms?.close()
  if (root && !process.env.CW_KEEP_EXPORT) fs.rmSync(root, { recursive: true, force: true })
})

describe('export.int: the exported site stands alone', () => {
  it('is a git repo of two commits with nothing left uncommitted, and .env.local ignored', () => {
    const log = spawnSync('git', ['-C', site, 'log', '--format=%s'], { encoding: 'utf8' }).stdout.trim().split('\n')
    expect(log).toEqual([
      'Make the copy standalone and configure it for novak-test',
      `Copy of the REALVISTA site template (platform ${report.platformCommit.slice(0, 7)})`,
    ])
    expect(spawnSync('git', ['-C', site, 'status', '--porcelain'], { encoding: 'utf8' }).stdout).toBe('')
    expect(spawnSync('git', ['-C', site, 'check-ignore', '-q', '.env.local']).status).toBe(0)
  })

  it('package.json has no workspace:, link: or ../', () => {
    const raw = fs.readFileSync(path.join(site, 'package.json'), 'utf8')
    expect(raw).not.toMatch(/workspace:|link:|\.\.\//)
    console.log(`\nexported package.json:\n${raw}`)
  })

  it('pnpm install, outside any workspace', async () => {
    const r = await run('pnpm', ['install'], site)
    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(path.join(site, 'node_modules/@makleri'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'pnpm-lock.yaml'))).toBe(true)
  })

  it('pnpm build, against the fake CMS', async () => {
    const r = await run('pnpm', ['build'], site)
    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(path.join(site, '.next/BUILD_ID'))).toBe(true)
    // the build really read the CMS (generateStaticParams, prerendered home)
    expect(cms.requests.some((q) => q.startsWith('GET /api/properties'))).toBe(true)
  })

  it('tsc --noEmit (pnpm typecheck)', async () => {
    const r = await run('pnpm', ['typecheck'], site)
    expect(r.status, r.out).toBe(0)
  })

  it('serves / with the colourway and the configured section order', async () => {
    server = spawn('pnpm', ['start'], { cwd: site, env: childEnv({ PORT: String(SITE_PORT) }), stdio: 'pipe' })
    let log = ''
    server.stdout?.on('data', (d: Buffer) => (log += d.toString()))
    server.stderr?.on('data', (d: Buffer) => (log += d.toString()))
    const deadline = Date.now() + 60_000
    let res: Response | undefined
    while (Date.now() < deadline) {
      res = await fetch(`http://127.0.0.1:${SITE_PORT}/`).catch(() => undefined)
      if (res) break
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(res?.status, log).toBe(200)
    const html = await res!.text()
    const expected = report.siteConfig.pages?.home?.sections ?? []
    expect(html).toContain(`data-variant="${report.siteConfig.theme.variant}"`)
    console.log(`\nGET / → ${res!.status}; data-variant="${report.siteConfig.theme.variant}"; data-section order: ${sectionOrder(html).join(',')}`)
    expect(sectionOrder(html)).toEqual(expected)

    const listing = await fetch(`http://127.0.0.1:${SITE_PORT}/nemovitosti/prodej-bytu-3-kk-praha-holesovice`)
    expect(listing.status).toBe(200)
    const media = await fetch(`http://127.0.0.1:${SITE_PORT}/api/media/file/fixture-1.jpg`)
    expect(media.headers.get('content-type')).toMatch(/^image\//)
  })
})
