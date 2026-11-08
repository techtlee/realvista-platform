import { CwError } from '../types.js'

/**
 * Reads the `importers:` section of a pnpm v9 lockfile.
 *
 * Only that section, and only its fixed shape:
 *
 *     importers:
 *       apps/site:
 *         dependencies:
 *           next:
 *             specifier: ^16.4.5
 *             version: 16.4.5(@types/node@22.20.4)(react@19.3.0)
 *
 * A full YAML parser would be a new runtime dependency for one block whose
 * layout pnpm itself fixes; the unit tests pin the shape with a fixture.
 * pnpm 12 writes a leading `---` config document, so the section is found
 * wherever it starts.
 */
export interface LockedDep {
  specifier: string
  version: string
}
export type ImporterDeps = Record<'dependencies' | 'devDependencies' | 'optionalDependencies', Record<string, LockedDep>>
export type LockImporters = Record<string, ImporterDeps>

const unquote = (s: string) => {
  const t = s.trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

export function parseLockImporters(lockfile: string): LockImporters {
  const lines = lockfile.split(/\r?\n/)
  const out: LockImporters = {}
  let sections = 0
  // pnpm 12 writes two YAML documents (config deps, then the project); both
  // may have an importers: section, and the project's comes last.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== 'importers:') continue
    sections++
    i = parseSection(lines, i + 1, out)
  }
  if (sections === 0) throw new CwError('PRECONDITION', 'pnpm-lock.yaml has no importers: section')
  return out
}

function parseSection(lines: string[], from: number, out: LockImporters): number {
  let importer: ImporterDeps | undefined
  let group: Record<string, LockedDep> | undefined
  let dep: LockedDep | undefined
  let i = from
  for (; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) return i - 1 // next top-level key (packages:, snapshots:, ---)
    const body = line.trim()
    // keys may be quoted ('@types/node':); a quoted key ends at "':"
    const keyEnd = body.startsWith("'") ? body.indexOf("':") + 1 : body.indexOf(':')
    const key = unquote(body.slice(0, keyEnd))
    const value = body.slice(keyEnd + 1).trim()
    if (indent === 2) {
      importer = { dependencies: {}, devDependencies: {}, optionalDependencies: {} }
      out[key] = importer
      group = undefined
      dep = undefined
    } else if (indent === 4 && importer) {
      group = (importer as Record<string, Record<string, LockedDep> | undefined>)[key]
      dep = undefined
    } else if (indent === 6 && group) {
      dep = { specifier: '', version: '' }
      group[key] = dep
    } else if (indent === 8 && dep) {
      if (key === 'specifier') dep.specifier = unquote(value)
      if (key === 'version') dep.version = unquote(value)
    }
  }
  return i
}

/** `16.4.5(@types/node@22.20.4)(react@19.3.0)` → `16.4.5` */
export const bareVersion = (v: string) => {
  const p = v.indexOf('(')
  return p < 0 ? v : v.slice(0, p)
}

/**
 * Exact versions for `externals`, as the platform's lockfile resolved them.
 *
 * `importers` is in priority order (apps/site first): the site's own
 * resolution wins, then the first workspace package that declares the
 * dependency. Pinning to what the monorepo actually built and tested with is
 * the point: a caret range would let the client's first install pick a
 * version nobody ran.
 */
export function pinDependencies(lockfile: string, importers: string[], externals: string[]): Record<string, string> {
  const lock = parseLockImporters(lockfile)
  const out: Record<string, string> = {}
  const missing: string[] = []
  for (const name of externals) {
    let found: string | undefined
    for (const imp of importers) {
      const deps = lock[imp]
      if (!deps) continue
      const hit = deps.dependencies[name] ?? deps.devDependencies[name] ?? deps.optionalDependencies[name]
      if (hit) {
        found = hit.version
        break
      }
    }
    if (found === undefined) {
      missing.push(name)
      continue
    }
    if (/^(link|workspace|file):/.test(found)) {
      throw new CwError('PRECONDITION', `${name} resolves to ${found} in pnpm-lock.yaml; an external must be a registry version`)
    }
    out[name] = bareVersion(found)
  }
  if (missing.length > 0) {
    throw new CwError('PRECONDITION', `not in pnpm-lock.yaml for ${importers.join(', ')}: ${missing.join(', ')}`, {
      hint: 'Run pnpm install in the platform repo and commit the lockfile.',
    })
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}
