import fs from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { computeClosureInTree, outPathFor } from '../../../src/site/closure.js'
import { MINI, miniCopy } from './helpers.js'

const tmp: string[] = []
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}, 60_000)
const copy = () => {
  const d = miniCopy()
  tmp.push(d)
  return d
}

describe('computeClosureInTree (mini monorepo)', () => {
  it('collects the app, the reached packages and their whole public JS surface', async () => {
    const c = await computeClosureInTree(MINI)
    expect(c.files).toEqual([
      'apps/site/app/globals.css',
      'apps/site/app/page.tsx',
      'apps/site/app/theme.ts',
      'apps/site/next.config.ts',
      'apps/site/package.json',
      'apps/site/site.config.ts',
      'apps/site/site.urls.ts',
      'apps/site/tsconfig.json',
      // config: the JS entry, plus the tsconfig base the site extends; NOT oxlintrc.json
      'packages/config/src/index.ts',
      'packages/config/tsconfig.base.json',
      // core: every export, followed into ./types.js; NOT unused.ts or tests/
      'packages/core/src/config.ts',
      'packages/core/src/format/index.ts',
      'packages/core/src/index.ts',
      'packages/core/src/types.ts',
      // theme: index + components (+ Frame via import, Map via dynamic import),
      // the stylesheet with its sibling; NOT the ./fixtures export
      'packages/theme/src/components/Frame.tsx',
      'packages/theme/src/components/Map.tsx',
      'packages/theme/src/components/index.tsx',
      'packages/theme/src/index.ts',
      'packages/theme/styles/fonts.css',
      'packages/theme/styles/theme.css',
    ])
    expect(c.packages.map((p) => p.name)).toEqual(['@makleri/config', '@makleri/core', '@makleri/theme'])
  })

  it('records bare externals with their first importer; builtins are not externals', async () => {
    const c = await computeClosureInTree(MINI)
    expect(c.externals).toEqual({
      next: 'apps/site',
      react: 'packages/theme',
      'react-dom': 'packages/theme',
      tailwindcss: 'packages/theme',
      zod: 'packages/core',
    })
  })

  it('maps every dist export back to its source and keeps assets as assets', async () => {
    const c = await computeClosureInTree(MINI)
    const theme = c.packages.find((p) => p.name === '@makleri/theme')!
    expect(theme.exports).toEqual([
      { specifier: '@makleri/theme', subpath: '.', kind: 'js', source: 'src/index.ts' },
      { specifier: '@makleri/theme/components', subpath: './components', kind: 'js', source: 'src/components/index.tsx' },
      { specifier: '@makleri/theme/styles/theme.css', subpath: './styles/theme.css', kind: 'asset', source: 'styles/theme.css' },
      { specifier: '@makleri/theme/fixtures', subpath: './fixtures', kind: 'js', source: 'src/fixtures/index.ts' },
    ])
    expect(theme.outDir).toBe('src/makleri/theme')
  })

  it('flattens paths: the app to the root, packages under src/makleri/', async () => {
    const c = await computeClosureInTree(MINI)
    expect(outPathFor('apps/site/app/page.tsx', c.packages)).toBe('app/page.tsx')
    expect(outPathFor('packages/core/src/format/index.ts', c.packages)).toBe('src/makleri/core/src/format/index.ts')
    const outs = c.files.map((f) => outPathFor(f, c.packages))
    expect(outs.every((o) => !o.startsWith('..') && !path.isAbsolute(o))).toBe(true)
  })

  it('refuses shipped code that imports test fixtures', async () => {
    const d = copy()
    fs.appendFileSync(path.join(d, 'packages/theme/src/index.ts'), `export { fixture } from './fixtures/index.js'\n`)
    await expect(computeClosureInTree(d)).rejects.toThrow(/fixtures\/index\.ts, which is test\/fixture\/conformance code/)
  })

  it('refuses a relative import that leaves its package', async () => {
    const d = copy()
    fs.appendFileSync(path.join(d, 'packages/core/src/index.ts'), `export * from '../../theme/src/index.js'\n`)
    await expect(computeClosureInTree(d)).rejects.toThrow(/leaves packages\/core/)
  })

  it('refuses an @makleri subpath the exports map does not list', async () => {
    const d = copy()
    fs.appendFileSync(path.join(d, 'apps/site/app/page.tsx'), `import '@makleri/core/internal'\n`)
    await expect(computeClosureInTree(d)).rejects.toThrow(/@makleri\/core\/internal is not in @makleri\/core's exports map/)
  })

  it('refuses an export whose source file is missing', async () => {
    const d = copy()
    fs.rmSync(path.join(d, 'packages/core/src/format/index.ts'))
    await expect(computeClosureInTree(d)).rejects.toThrow(/export \.\/format .* has no source/)
  })

  it('refuses an unresolvable relative import', async () => {
    const d = copy()
    fs.appendFileSync(path.join(d, 'packages/core/src/index.ts'), `export * from './gone.js'\n`)
    await expect(computeClosureInTree(d)).rejects.toThrow(/cannot resolve \.\/gone\.js/)
  })
})
