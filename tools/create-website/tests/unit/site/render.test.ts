import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { computeClosureInTree } from '../../../src/site/closure.js'
import { siteConfigInputFor } from '../../../src/site/export.js'
import {
  buildTsconfig,
  pathsFromExports,
  renderEnvExample,
  renderGlobalsCss,
  renderNextConfig,
  renderPackageJson,
  renderSiteConfig,
  renderSiteUrls,
  siteUrlFor,
  tsLiteral,
} from '../../../src/site/render.js'
import { FIXTURES, MINI, novakRequest } from './helpers.js'

/** The selection literal: from `defineSiteConfig(` up to the `cms:` key. */
const selectionBody = (s: string) => {
  const m = /defineSiteConfig\(\n([\s\S]*?)\n {4}cms: \{/.exec(s)
  if (!m) throw new Error('no defineSiteConfig( … cms: in file')
  return m[1]
}

describe('renderSiteConfig', () => {
  const input = siteConfigInputFor(novakRequest(), { subdomainBase: 'realvista.cz' })

  it("reproduces client #1's hand-made selection literal byte for byte", () => {
    // The hand-made file (c5014d5) predates B2 (cw/1 20ce8fa), which moved the
    // CMS origin into site.urls.ts and added the agreement check. So the
    // documented differences are exactly: the header comment, the site.urls
    // import, `url: cmsUrl`, and the check at the end. Everything the client
    // selected is identical.
    const handMade = fs.readFileSync(path.join(FIXTURES, 'novak-test.site.config.ts.txt'), 'utf8')
    const generated = renderSiteConfig(input, { platformSha7: 'abc1234' })
    expect(selectionBody(generated)).toBe(selectionBody(handMade))
    expect(generated).toContain('create-website exporter (platform abc1234)')
    // the tenant fallback is client #1's
    expect(generated).toContain('tenantId: Number(process.env.TENANT_ID ?? 1)')
    expect(handMade).toContain('tenantId: Number(process.env.TENANT_ID ?? 1)')
  })

  it('has the template B2 shape: cms url from site.urls, siteUrl agreement check', async () => {
    const generated = renderSiteConfig(input)
    expect(generated).toContain(`import { cmsUrl, siteUrl } from './site.urls'`)
    expect(generated).toContain('      url: cmsUrl,')
    expect(generated).toContain('if (site.siteUrl !== siteUrl)')
    expect(generated).toMatch(/export default site\n$/)
    expect(generated).not.toContain('NEXT_PUBLIC_CMS_URL') // read once, in site.urls.ts
  })

  it('snapshot', () => {
    expect(renderSiteConfig(input)).toMatchSnapshot()
  })

  it('site.urls.ts agrees with site.config.ts (same input, same origins)', () => {
    const urls = renderSiteUrls({ siteUrl: siteUrlFor(input), cmsUrlDefault: input.cms.url })
    expect(urls).toMatchSnapshot()
    expect(renderSiteConfig(input)).toContain(`domain: '${input.domain}'`)
    expect(urls).toContain(`export const siteUrl = 'https://${input.domain}'`)
    expect(urls).toContain(`export const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? 'https://admin.novak-test.realvista.cz'`)
    expect(urls).not.toMatch(/^import /m) // next.config loads it without the theme
  })

  it('site.urls.ts and site.config.ts evaluate to the same siteUrl', async () => {
    // Evaluate the generated site.urls.ts, and the domain → siteUrl rule the
    // generated site.config.ts runs at load (its throw guards the same thing).
    const urls = renderSiteUrls({ siteUrl: siteUrlFor(input), cmsUrlDefault: input.cms.url })
    const js = urls.replace(/process\.env\.NEXT_PUBLIC_CMS_URL/, 'undefined')
    const mod = (await import(`data:text/javascript,${encodeURIComponent(js)}`)) as { siteUrl: string; cmsUrl: string }
    expect(mod.siteUrl).toBe(siteUrlFor(input))
    expect(mod.cmsUrl).toBe(input.cms.url)
  })

  it('maps local mode to the platform subdomain even when the client owns a domain', () => {
    expect(input.domain).toBe('novak-test.realvista.cz')
    expect(siteUrlFor({ domain: 'http://x.cz/' })).toBe('https://x.cz')
  })

  it('rejects an invalid selection with the catalog message per path', () => {
    const bad = novakRequest()
    ;(bad.provisioning as unknown as { theme: { variant: string } }).theme.variant = 'purple'
    expect(() => siteConfigInputFor(bad, { subdomainBase: 'realvista.cz' })).toThrow(/theme\.variant/)
  })
})

describe('tsLiteral', () => {
  it('escapes quotes, backslashes and newlines instead of breaking the file', () => {
    expect(tsLiteral({ name: "Reality 'U Nováků'", path: 'a\\b', note: 'x\ny' })).toBe(
      `{\n  name: 'Reality \\'U Nováků\\'',\n  path: 'a\\\\b',\n  note: 'x\\ny'\n}`,
    )
  })
  it('quotes keys that are not identifiers', () => {
    expect(tsLiteral({ 'a-b': 1, ok: true, list: [], obj: {} })).toBe(`{\n  'a-b': 1,\n  ok: true,\n  list: [],\n  obj: {}\n}`)
  })
})

describe('buildTsconfig', () => {
  it('has a path for every non-test JS export of every package, and nothing else', async () => {
    const c = await computeClosureInTree(MINI)
    const site = JSON.parse(fs.readFileSync(path.join(MINI, 'apps/site/tsconfig.json'), 'utf8'))
    const base = JSON.parse(fs.readFileSync(path.join(MINI, 'packages/config/tsconfig.base.json'), 'utf8'))
    const ts = buildTsconfig(base, c.packages, site)
    const paths = ts.compilerOptions!.paths as Record<string, string[]>

    const expected: Record<string, string[]> = { '@/*': ['./*'] }
    for (const p of c.packages) {
      const pj = JSON.parse(fs.readFileSync(path.join(MINI, p.dir, 'package.json'), 'utf8'))
      for (const [sub, target] of Object.entries(pj.exports as Record<string, unknown>)) {
        const js = typeof target === 'string' ? target : (target as { import: string }).import
        if (!js.endsWith('.js') || sub.includes('fixtures')) continue
        const spec = sub === '.' ? p.name : `${p.name}/${sub.slice(2)}`
        const src = js.replace('./dist/', 'src/').replace(/\.js$/, '')
        const ext = fs.existsSync(path.join(MINI, p.dir, `${src}.tsx`)) ? '.tsx' : '.ts'
        expected[spec] = [`./${p.outDir}/${src}${ext}`]
      }
    }
    expect(paths).toEqual(expected)
    // every target exists in the closure
    for (const [spec, [target]] of Object.entries(paths)) {
      if (spec === '@/*') continue
      const pkg = c.packages.find((p) => target!.startsWith(`./${p.outDir}/`))!
      expect(c.files).toContain(`${pkg.dir}/${target!.slice(pkg.outDir.length + 3)}`)
    }
  })

  it('inlines the base, drops emit-only options, forces react-jsx + noEmit, adds .next/dev/types', async () => {
    const c = await computeClosureInTree(MINI)
    const site = JSON.parse(fs.readFileSync(path.join(MINI, 'apps/site/tsconfig.json'), 'utf8'))
    const base = JSON.parse(fs.readFileSync(path.join(MINI, 'packages/config/tsconfig.base.json'), 'utf8'))
    const ts = buildTsconfig(base, c.packages, site)
    expect(ts.extends).toBeUndefined()
    expect(Object.keys(ts.compilerOptions!)).toEqual(['target', 'module', 'moduleResolution', 'jsx', 'strict', 'noEmit', 'plugins', 'paths'])
    expect(ts.compilerOptions!.jsx).toBe('react-jsx')
    expect(ts.include).toEqual(['**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'])
    expect(ts.exclude).toEqual(['node_modules', '.next'])
  })

  it('pathsFromExports is sorted by specifier', async () => {
    const c = await computeClosureInTree(MINI)
    const specs = pathsFromExports(c.packages).map(([s]) => s)
    expect(specs).toEqual([...specs].sort())
  })
})

describe('the other generated files', () => {
  it('package.json: pinned versions only, the site port, typecheck', () => {
    const pj = renderPackageJson({
      slug: 'svoboda-reality',
      sitePort: 3111,
      deps: { zod: '4.6.5', next: '16.4.5' },
      devDeps: { typescript: '5.9.3' },
      packageManager: 'pnpm@12.6.0',
      engines: { node: '>=22' },
      scripts: { dev: 'next dev --port ${PORT:-3001}', build: 'next build', start: 'next start --port ${PORT:-3001}' },
    })
    expect(pj).toMatchSnapshot()
    expect(pj).not.toMatch(/workspace:|link:|\.\.\//)
    expect(JSON.parse(pj).dependencies).toEqual({ next: '16.4.5', zod: '4.6.5' }) // sorted
  })

  it('next.config.ts: only the @makleri/config import changes, to the flattened source', () => {
    const template = `import { createNextConfig } from '@makleri/config'\n\n// Not site.config.ts\nimport { cmsUrl, siteUrl } from './site.urls'\n\nexport default createNextConfig({ siteUrl, cmsUrl })\n`
    expect(renderNextConfig(template, { name: '@makleri/config', outDir: 'src/makleri/config' })).toBe(
      template.replace(`'@makleri/config'`, `'./src/makleri/config/src/index'`),
    )
  })

  it('next.config.ts: refuses a pre-B2 template that imports site.config', () => {
    const preB2 = `import { createNextConfig } from '@makleri/config'\nimport site from './site.config'\nexport default createNextConfig({ siteUrl: site.siteUrl, cmsUrl: site.cms.url })\n`
    expect(() => renderNextConfig(preB2, { name: '@makleri/config', outDir: 'src/makleri/config' })).toThrow(/B2/)
  })

  it('globals.css points at the in-repo theme', async () => {
    const c = await computeClosureInTree(MINI)
    expect(renderGlobalsCss(c.packages.find((p) => p.name === '@makleri/theme')!)).toMatchSnapshot()
  })

  it('.env.example has names and the local backend origin, never values', () => {
    const s = renderEnvExample({ slug: 'novak-test', backendPort: 3027, tenantId: 1 })
    expect(s).toContain('NEXT_PUBLIC_CMS_URL=http://localhost:3027')
    expect(s).toMatch(/^CMS_API_KEY=$/m)
    expect(s).toMatch(/^REVALIDATE_SECRET=$/m)
  })
})
