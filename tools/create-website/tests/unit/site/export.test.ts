import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findSpecifiers, isRelative } from '../../../src/site/specifiers.js'
import { exportSite, STEP_TRAILER, TEMPLATE_TRAILER } from '../../../src/site/export.js'
import { miniCopy, novakRequest } from './helpers.js'

const tmp: string[] = []
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}, 60_000)
const track = (d: string) => (tmp.push(d), d)
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })

async function exportMini(extra: { dirty?: boolean } = {}) {
  const platform = track(miniCopy({ git: true }))
  if (extra.dirty) fs.appendFileSync(path.join(platform, 'packages/core/src/format/index.ts'), `export const DIRTY = 1\n`)
  const clients = track(fs.mkdtempSync(path.join(os.tmpdir(), 'cw5-clients-')))
  const outDir = path.join(clients, 'site-novak-test')
  const report = await exportSite({
    platformRoot: platform,
    commit: 'HEAD',
    outDir,
    request: novakRequest(),
    ports: { site: 4151, backend: 4150 },
    subdomainBase: 'realvista.cz',
    runId: 'cw-test',
  })
  return { platform, clients, outDir, report }
}

const walk = (dir: string, rel = ''): string[] =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.name === '.git' ? [] : e.isDirectory() ? walk(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`],
  )

describe('exportSite (mini monorepo)', { timeout: 60_000 }, () => {
  it('makes two commits: the pristine copy, then the standalone rewrite, each with its trailer', async () => {
    const { outDir, report, platform } = await exportMini()
    const sha = git(platform, 'rev-parse', 'HEAD').trim()
    expect(report.platformCommit).toBe(sha)
    const log = git(outDir, 'log', '--format=%H%x00%s%x00%(trailers:only,unfold)%x01').split('\x01').filter((l) => l.trim())
    expect(log).toHaveLength(2)
    const [standalone, pristine] = log.map((l) => l.trim().split('\x00'))
    expect(pristine![1]).toBe(`Copy of the REALVISTA site template (platform ${sha.slice(0, 7)})`)
    expect(pristine![2]).toContain(`${TEMPLATE_TRAILER}: platform@${sha}`)
    expect(standalone![1]).toBe('Make the copy standalone and configure it for novak-test')
    expect(standalone![2]).toContain(`${STEP_TRAILER}: site-standalone`)
    expect(report.commits).toEqual({ pristine: pristine![0], standalone: standalone![0] })
    expect(git(outDir, 'status', '--porcelain')).toBe('')
  })

  it('the pristine commit is a byte-for-byte flattened copy', async () => {
    const { outDir, platform } = await exportMini()
    const show = (dir: string, rev: string, p: string) => git(dir, 'show', `${rev}:${p}`)
    expect(show(outDir, 'HEAD~1', 'src/makleri/core/src/index.ts')).toBe(show(platform, 'HEAD', 'packages/core/src/index.ts'))
    expect(show(outDir, 'HEAD~1', 'app/page.tsx')).toBe(show(platform, 'HEAD', 'apps/site/app/page.tsx'))
    expect(show(outDir, 'HEAD~1', 'package.json')).toContain('workspace:*')
  })

  it('package.json has no workspace:/link:/../ and pins from the lockfile', async () => {
    const { outDir, report } = await exportMini()
    const raw = fs.readFileSync(path.join(outDir, 'package.json'), 'utf8')
    expect(raw).not.toMatch(/workspace:|link:|\.\.\//)
    const pj = JSON.parse(raw)
    expect(pj.name).toBe('site-novak-test')
    expect(pj.packageManager).toBe('pnpm@12.6.0')
    expect(pj.scripts.dev).toBe('next dev --port ${PORT:-4151}')
    expect(pj.dependencies).toEqual({ next: '16.4.5', react: '19.3.0', 'react-dom': '19.3.0', zod: '4.6.5' })
    expect(pj.devDependencies).toEqual({ '@types/react': '19.3.0', '@types/react-dom': '19.3.0', tailwindcss: '4.3.3', typescript: '5.9.3' })
    expect(report.dependencies).toEqual(pj.dependencies)
  })

  it('no relative import leaves the repo, none keeps .js, and no @makleri import lacks a path', async () => {
    const { outDir } = await exportMini()
    const ts = JSON.parse(fs.readFileSync(path.join(outDir, 'tsconfig.json'), 'utf8'))
    const paths = ts.compilerOptions.paths as Record<string, string[]>
    for (const f of walk(outDir).filter((f) => /\.(tsx?|mjs)$/.test(f))) {
      for (const s of findSpecifiers(fs.readFileSync(path.join(outDir, f), 'utf8'), f)) {
        if (isRelative(s.text)) {
          const target = path.resolve(outDir, path.dirname(f), s.text)
          expect(target.startsWith(outDir + path.sep), `${f}: ${s.text}`).toBe(true)
          expect(s.text.endsWith('.js'), `${f}: ${s.text}`).toBe(false)
        } else if (s.text.startsWith('@makleri/')) {
          expect(paths[s.text], `${f}: ${s.text}`).toBeDefined()
        }
      }
    }
    expect(fs.readFileSync(path.join(outDir, 'src/makleri/theme/src/components/index.tsx'), 'utf8')).toContain(`import('./Map')`)
    for (const [, [target]] of Object.entries(paths)) {
      if (target !== './*') expect(fs.existsSync(path.join(outDir, target!)), target).toBe(true)
    }
  })

  it('writes the generated files and drops the inlined tsconfig base', async () => {
    const { outDir } = await exportMini()
    const files = walk(outDir).sort()
    for (const f of ['site.config.ts', 'site.urls.ts', 'next.config.ts', '.env.example', '.gitignore', 'README.md', '.github/dependabot.yml']) {
      expect(files).toContain(f)
    }
    expect(files).not.toContain('src/makleri/config/tsconfig.base.json')
    expect(files).not.toContain('src/makleri/config/oxlintrc.json')
    expect(fs.readFileSync(path.join(outDir, 'app/globals.css'), 'utf8')).toContain(`@import '../src/makleri/theme/styles/theme.css'`)
    const nextConfig = fs.readFileSync(path.join(outDir, 'next.config.ts'), 'utf8')
    expect(nextConfig).not.toContain('site.config')
    expect(nextConfig).toContain(`from './src/makleri/config/src/index'`)
    expect(nextConfig).toContain('// B2: the origins come from site.urls.ts') // the template's own text survives
    expect(fs.readFileSync(path.join(outDir, 'site.urls.ts'), 'utf8')).toContain(`siteUrl = 'https://novak-test.realvista.cz'`)
    expect(fs.readFileSync(path.join(outDir, 'README.md'), 'utf8')).not.toMatch(/\{\{\w+\}\}/)
    expect(fs.readFileSync(path.join(outDir, '.gitignore'), 'utf8')).toMatch(/^\.env\*\.local$/m)
  })

  it('archives the commit: an uncommitted change in the platform never leaks in', async () => {
    const { outDir } = await exportMini({ dirty: true })
    expect(fs.readFileSync(path.join(outDir, 'src/makleri/core/src/format/index.ts'), 'utf8')).not.toContain('DIRTY')
  })

  it('leaves no temp dir behind', async () => {
    const { clients } = await exportMini()
    expect(fs.readdirSync(clients)).toEqual(['site-novak-test'])
  })

  it('refuses a non-empty target with TARGET_EXISTS and does not touch it', async () => {
    const platform = track(miniCopy({ git: true }))
    const clients = track(fs.mkdtempSync(path.join(os.tmpdir(), 'cw5-clients-')))
    const outDir = path.join(clients, 'site-novak-test')
    fs.mkdirSync(outDir)
    fs.writeFileSync(path.join(outDir, 'mine.txt'), 'hand-made')
    await expect(
      exportSite({ platformRoot: platform, commit: 'HEAD', outDir, request: novakRequest(), ports: { site: 4151, backend: 4150 }, subdomainBase: 'realvista.cz' }),
    ).rejects.toMatchObject({ code: 'TARGET_EXISTS' })
    expect(fs.readdirSync(outDir)).toEqual(['mine.txt'])
    expect(fs.readdirSync(clients)).toEqual(['site-novak-test'])
  })

  it('cleans its temp dir when a step fails (invalid selection is caught before any write)', async () => {
    const platform = track(miniCopy({ git: true }))
    const clients = track(fs.mkdtempSync(path.join(os.tmpdir(), 'cw5-clients-')))
    const req = novakRequest()
    ;(req.provisioning as unknown as { domain?: unknown }).domain = undefined
    await expect(
      exportSite({ platformRoot: platform, commit: 'HEAD', outDir: path.join(clients, 'site-x'), request: req, ports: { site: 4151, backend: 4150 }, subdomainBase: 'realvista.cz' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fs.readdirSync(clients)).toEqual([])
  })
})
