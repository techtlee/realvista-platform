import ts from 'typescript'

/**
 * Every module specifier in a TS/TSX/JS source, found with the TypeScript
 * parser rather than a regex.
 *
 * A regex over `from '…'` misses `export * from`, multi-line imports with
 * comments, `import('…')` and `import('…').Type`, and matches specifiers that
 * only appear inside strings or comments. The exporter both follows these
 * (closure) and rewrites them (B3), so the two must see exactly the same set.
 */
export interface SpecifierRef {
  /** the specifier text, unquoted */
  text: string
  /** offsets of the text INSIDE the quotes, in the original source */
  start: number
  end: number
  kind: 'import' | 'export' | 'dynamic' | 'import-type'
  /** `import type …` / `export type …` / `import('…').T` — erased at runtime */
  typeOnly: boolean
}

export function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.(c|m)?js$/.test(fileName)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

export function findSpecifiers(source: string, fileName: string): SpecifierRef[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  const out: SpecifierRef[] = []

  const push = (lit: ts.Node, kind: SpecifierRef['kind'], typeOnly: boolean) => {
    if (!ts.isStringLiteral(lit) && !ts.isNoSubstitutionTemplateLiteral(lit)) return
    // getStart() skips leading trivia; +1/-1 drop the quote characters.
    const start = lit.getStart(sf) + 1
    const end = lit.getEnd() - 1
    out.push({ text: lit.text, start, end, kind, typeOnly })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = node.importClause?.isTypeOnly ?? false
      push(node.moduleSpecifier, 'import', typeOnly)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      push(node.moduleSpecifier, 'export', node.isTypeOnly)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      push(node.arguments[0]!, 'dynamic', false)
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg)) push(arg.literal, 'import-type', true)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      push(node.moduleReference.expression, 'import', node.isTypeOnly)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out.sort((a, b) => a.start - b.start)
}

export const isRelative = (spec: string) => spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')

/**
 * B3: drop the `.js` suffix from relative specifiers.
 *
 * The packages are written for `tsc` + plain-Node consumers, where
 * `./x.js` is correct and resolves to the compiled `x.js`. The exported site
 * consumes the *sources* through Turbopack, which does not map `./x.js` to
 * `./x.ts`. Only relative specifiers change: `some-lib/file.js` is a real file
 * in a real package and stays exactly as written. Everything else in the file
 * (quotes, comments, formatting) is preserved byte for byte.
 */
export function rewriteRelativeJsSpecifiers(source: string, fileName: string): string {
  const edits = findSpecifiers(source, fileName).filter((s) => isRelative(s.text) && s.text.endsWith('.js'))
  if (edits.length === 0) return source
  let out = ''
  let at = 0
  for (const e of edits) {
    out += source.slice(at, e.start) + e.text.slice(0, -'.js'.length)
    at = e.end
  }
  return out + source.slice(at)
}
