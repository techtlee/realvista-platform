/**
 * Golden regression (design §B): provision novak-test.request.json with ports
 * 4171/4271 into a temp clients dir and diff the generated site-novak-test
 * against Makleri/clients/site-novak-test HEAD (read through `git archive`,
 * never written).
 *
 * Allowed differences:
 * - excluded files: pnpm-lock.yaml, .env*, README*, site.urls.ts, the P1/P2
 *   files (next.config.ts, theme-realvista pages/index.tsx)
 * - package.json: port numbers in scripts; dependency VERSIONS (the platform's
 *   lockfile moved since 6411b88), but not the dependency NAMES
 * - site.config.ts: the header comment
 * - template drift: a file whose platform source changed between the commit
 *   client #1 was copied from (6411b88) and the commit this run archived.
 *   These are listed in the test output, not failed.
 * Anything else fails the test: the generator must reproduce the hand-made client.
 *
 * Needs the real novak-test DB? No: everything runs on cwtest_<rand>_ DBs.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, PLATFORM, REAL_CLIENTS, cw, destroyRoot, e2eEnabled, explain, git, makeRoot, sh, state, type Root } from './helpers.js'

const SLUG = 'novak-test'
const EXCLUDE = [/^pnpm-lock\.yaml$/, /(^|\/)\.env/, /(^|\/)README/i, /^site\.urls\.ts$/, /^next\.config\.ts$/, /^src\/makleri\/theme-realvista\/src\/pages\/index\.tsx$/]

/** generated path → platform source path (for the drift check) */
function platformSource(rel: string): string {
  const m = rel.match(/^src\/makleri\/([^/]+)\/(.+)$/)
  if (m) return `packages/${m[1]}/${m[2]}`
  return `apps/site/${rel}`
}

function stripHeaderComment(src: string): string {
  return src.replace(/\/\*\*[\s\S]*?\*\/\s*/, '')
}

function normalisePackageJson(txt: string) {
  const p = JSON.parse(txt)
  const scripts = Object.fromEntries(Object.entries<string>(p.scripts ?? {}).map(([k, v]) => [k, v.replace(/\d{4,5}/g, '<port>')]))
  return { ...p, name: p.name, scripts, dependencies: Object.keys(p.dependencies ?? {}).sort(), devDependencies: Object.keys(p.devDependencies ?? {}).sort() }
}

describe.skipIf(!e2eEnabled || !REAL_CLIENTS)('golden: generated site-novak-test == hand-made client #1', () => {
  let root: Root
  let run: ReturnType<typeof cw>
  let golden: string
  let generated: string
  let baseCommit = '6411b88'
  let archivedCommit = ''

  beforeAll(() => {
    root = makeRoot({ site: [4171, 4171], backend: [4271, 4271] })
    run = cw(root, ['run', '--request', join(FIXTURES, 'novak-test.request.json'), '--site-port', '4171', '--backend-port', '4271'])
    generated = join(root.clients, `site-${SLUG}`)
    golden = join(root.dir, 'golden-site-novak-test')
    mkdirSync(golden, { recursive: true })
    const realSite = join(REAL_CLIENTS!, 'site-novak-test')
    const arch = sh('bash', ['-c', `git -C "${realSite}" archive HEAD | tar -x -C "${golden}"`])
    if (arch.code !== 0) throw new Error(arch.stderr)
    baseCommit = git(realSite, ['log', '--reverse', '--format=%s']).split('\n')[0]!.match(/platform main ([0-9a-f]{7})/)?.[1] ?? baseCommit
    if (existsSync(join(root.clients, SLUG, 'create-website.state.json'))) archivedCommit = state(root, SLUG).templates.platform.commit
  })

  afterAll(async () => {
    await destroyRoot(root)
  })

  it('provisions novak-test on 4171/4271', () => {
    expect(run.code, explain(run)).toBe(0)
    expect(state(root, SLUG).ports).toEqual({ site: 4171, backend: 4271 })
  })

  it('the generated tree matches the hand-made one except for documented differences', () => {
    const list = (d: string) => (existsSync(join(d, '.git')) ? git(d, ['ls-files']) : sh('bash', ['-c', `cd "${d}" && find . -type f | sed 's#^./##'`]).stdout).split('\n').filter(Boolean)
    const gen = new Set(list(generated).filter((f) => !EXCLUDE.some((r) => r.test(f))))
    const gold = new Set(list(golden).filter((f) => !EXCLUDE.some((r) => r.test(f))))
    const drift = (rel: string) => archivedCommit && sh('git', ['-C', PLATFORM, 'diff', '--quiet', baseCommit, archivedCommit, '--', platformSource(rel)]).code === 1

    const failures: string[] = []
    const drifted: string[] = []
    for (const f of gold) if (!gen.has(f)) (drift(f) ? drifted : failures).push(`missing in generated: ${f}`)
    for (const f of gen) if (!gold.has(f)) (drift(f) ? drifted : failures).push(`extra in generated: ${f}`)
    for (const f of [...gold].filter((x) => gen.has(x))) {
      const a = readFileSync(join(golden, f), 'utf8')
      const b = readFileSync(join(generated, f), 'utf8')
      let same = a === b
      if (!same && f === 'package.json') same = JSON.stringify(normalisePackageJson(a)) === JSON.stringify(normalisePackageJson(b))
      if (!same && f === 'site.config.ts') same = stripHeaderComment(a) === stripHeaderComment(b)
      if (!same) {
        if (drift(f)) drifted.push(`changed (template drift ${baseCommit}..${archivedCommit.slice(0, 7)}): ${f}`)
        else {
          const d = sh('diff', ['-u', join(golden, f), join(generated, f)]).stdout.split('\n').slice(0, 40).join('\n')
          failures.push(`differs: ${f}\n${d}`)
        }
      }
    }
    if (drifted.length) console.info(`golden: allowed template drift:\n  ${drifted.join('\n  ')}`)
    expect(failures, failures.join('\n\n')).toEqual([])
  })

  it('site.urls.ts and site.config.ts agree (B2)', () => {
    const urls = readFileSync(join(generated, 'site.urls.ts'), 'utf8')
    const cfg = readFileSync(join(generated, 'site.config.ts'), 'utf8')
    expect(urls).toContain('https://novak-test.realvista.cz')
    expect(cfg).toContain("domain: 'novak-test.realvista.cz'")
    expect(readFileSync(join(generated, 'next.config.ts'), 'utf8')).not.toMatch(/site\.config/)
  })

  it('the generated site renders clay with client #1\'s section order', async () => {
    const html = await (await fetch('http://127.0.0.1:4171/')).text()
    expect(html).toMatch(/<html[^>]*data-variant="clay"/)
    const order: string[] = []
    for (const m of html.matchAll(/data-section="([^"]+)"/g)) if (!order.includes(m[1]!)) order.push(m[1]!)
    expect(order).toEqual(['hero', 'agent', 'featured', 'stats', 'services', 'blog', 'contact'])
  })
})
