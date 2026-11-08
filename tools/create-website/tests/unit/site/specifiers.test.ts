import { describe, expect, it } from 'vitest'

import { findSpecifiers, rewriteRelativeJsSpecifiers } from '../../../src/site/specifiers.js'

const rw = (src: string, file = 'x.ts') => rewriteRelativeJsSpecifiers(src, file)

describe('rewriteRelativeJsSpecifiers (B3)', () => {
  it('rewrites export * and named re-exports', () => {
    expect(rw(`export * from './client.js'\nexport { a, b } from "./types.js"\n`)).toBe(
      `export * from './client'\nexport { a, b } from "./types"\n`,
    )
  })

  it('rewrites import type and export type', () => {
    expect(rw(`import type { Media } from '../content/types.js'\nexport type { X } from './x.js'\n`)).toBe(
      `import type { Media } from '../content/types'\nexport type { X } from './x'\n`,
    )
  })

  it('rewrites dynamic import() and import types', () => {
    expect(rw(`const m = await import('./Map.js')\ntype T = import('./types.js').Media\n`)).toBe(
      `const m = await import('./Map')\ntype T = import('./types').Media\n`,
    )
  })

  it('rewrites ../ paths, including multi-line imports with comments', () => {
    const src = `import {\n  // the glyph\n  ServiceGlyph,\n} from '../icons.js' // trailing\n`
    expect(rw(src, 'components/index.tsx')).toBe(`import {\n  // the glyph\n  ServiceGlyph,\n} from '../icons' // trailing\n`)
  })

  it('leaves non-relative .js specifiers untouched', () => {
    const src = `import x from 'some-lib/file.js'\nimport y from '@scope/pkg/dist/y.js'\nexport * from 'z.js'\n`
    expect(rw(src)).toBe(src)
  })

  it('ignores specifier-looking text in strings and comments', () => {
    const src = `// import a from './a.js'\nconst s = "from './b.js'"\nconst t = \`import('./c.js')\`\n`
    expect(rw(src)).toBe(src)
  })

  it('leaves relative imports without .js, and .json/.css, alone', () => {
    const src = `import a from './a'\nimport b from './b.json'\nimport './c.css'\nimport d from './d.jsx'\n`
    expect(rw(src)).toBe(src)
  })

  it('parses TSX (JSX in the file does not confuse the scanner)', () => {
    const src = `import { Frame } from './Frame.js'\nexport const C = () => <Frame>{'./x.js'}</Frame>\n`
    expect(rw(src, 'C.tsx')).toBe(`import { Frame } from './Frame'\nexport const C = () => <Frame>{'./x.js'}</Frame>\n`)
  })

  it('is idempotent', () => {
    const once = rw(`export * from './a.js'\n`)
    expect(rw(once)).toBe(once)
  })
})

describe('findSpecifiers', () => {
  it('reports kind and type-only-ness', () => {
    const src = [
      `import type { A } from './a.js'`,
      `import { b } from 'b'`,
      `export * from './c.js'`,
      `export type { D } from './d.js'`,
      `const e = import('./e.js')`,
      `type F = import('./f.js').F`,
      `import './side-effect.css'`,
    ].join('\n')
    expect(findSpecifiers(src, 'x.ts').map((s) => [s.text, s.kind, s.typeOnly])).toEqual([
      ['./a.js', 'import', true],
      ['b', 'import', false],
      ['./c.js', 'export', false],
      ['./d.js', 'export', true],
      ['./e.js', 'dynamic', false],
      ['./f.js', 'import-type', true],
      ['./side-effect.css', 'import', false],
    ])
  })
})
