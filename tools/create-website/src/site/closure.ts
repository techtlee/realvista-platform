import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { CwError } from '../types.js'
import { findSpecifiers, isRelative } from './specifiers.js'

const execFileP = promisify(execFile)

/** The app that becomes the client repo's root. */
export const SITE_APP = 'apps/site'
/** Where workspace packages land inside the client repo. */
export const FLAT_PREFIX = 'src/makleri'

export interface ExportEntry {
  /** `@makleri/core/config` */
  specifier: string
  /** `./config` */
  subpath: string
  kind: 'js' | 'asset'
  /** source path relative to the package dir: `src/config.ts`, `styles/theme.css` */
  source: string
}

export interface PkgInfo {
  name: string
  version: string
  /** relative to the platform root: `packages/core` */
  dir: string
  /** relative to the client repo root: `src/makleri/core` */
  outDir: string
  /** every export of the package, with dist targets mapped back to sources */
  exports: ExportEntry[]
  packageJson: PackageJson
}

export interface PackageJson {
  name: string
  version?: string
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  [k: string]: unknown
}

export interface Closure {
  /** platform-relative paths of every file the client repo needs, sorted */
  files: string[]
  /** workspace packages reached from the site, sorted by name */
  packages: PkgInfo[]
  /** bare external package name → platform-relative dir of the first importer that imports it */
  externals: Record<string, string>
  /** the directory `files` are relative to (an archive of the commit, or a checkout) */
  treeRoot: string
}

const CODE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/
const EXCLUDED = /(^|\/)(tests?|__tests__|fixtures|conformance)(\/|$)/
const TS_FOR_JS = ['.ts', '.tsx', '.mts']
const PROBE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']
const BUILTINS = new Set(builtinModules)

export const packageNameOf = (spec: string) => {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

const exists = async (p: string) =>
  fs.stat(p).then(
    (s) => s.isFile(),
    () => false,
  )

/**
 * Archives `commit` into a fresh temp dir and computes the closure there, so a
 * dirty working tree never leaks into a client repo. The caller owns
 * `treeRoot` and removes it when done.
 */
export async function computeClosure(platformRoot: string, commit: string): Promise<Closure> {
  const treeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-platform-'))
  try {
    await archiveCommit(platformRoot, commit, treeRoot)
    return await computeClosureInTree(treeRoot)
  } catch (err) {
    await fs.rm(treeRoot, { recursive: true, force: true })
    throw err
  }
}

export async function archiveCommit(repo: string, commit: string, into: string): Promise<void> {
  const tar = path.join(into, '.archive.tar')
  await execFileP('git', ['-C', repo, 'archive', '--format=tar', '-o', tar, commit, '--', SITE_APP, 'packages', 'package.json', 'pnpm-lock.yaml'])
  await execFileP('tar', ['-xf', tar, '-C', into])
  await fs.rm(tar)
}

async function listFiles(root: string, rel: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue
      const p = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) out.push(p)
    }
  }
  await walk(rel)
  return out
}

/** Loads every `packages/*` workspace package with its exports mapped to sources. */
export async function loadWorkspacePackages(treeRoot: string): Promise<Map<string, PkgInfo>> {
  const map = new Map<string, PkgInfo>()
  const dirs = await fs.readdir(path.join(treeRoot, 'packages'), { withFileTypes: true }).catch(() => [])
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dir = `packages/${d.name}`
    const pj = path.join(treeRoot, dir, 'package.json')
    if (!(await exists(pj))) continue
    const packageJson = JSON.parse(await fs.readFile(pj, 'utf8')) as PackageJson
    const exportsList: ExportEntry[] = []
    for (const [subpath, target] of Object.entries(packageJson.exports ?? {})) {
      exportsList.push(await mapExport(treeRoot, dir, packageJson.name, subpath, target))
    }
    map.set(packageJson.name, {
      name: packageJson.name,
      version: packageJson.version ?? '0.0.0',
      dir,
      outDir: `${FLAT_PREFIX}/${d.name}`,
      exports: exportsList,
      packageJson,
    })
  }
  return map
}

/**
 * `"./config": {"import": "./dist/config.js"}` → `src/config.ts`.
 *
 * The packages publish compiled `dist/`; the client repo carries sources. The
 * mapping is the one `tsconfig.build.json` implies (src → dist, .ts/.tsx →
 * .js), checked against the files that actually exist so a moved file fails
 * here, not in the client's build.
 */
async function mapExport(treeRoot: string, dir: string, name: string, subpath: string, target: unknown): Promise<ExportEntry> {
  const specifier = subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`
  const raw =
    typeof target === 'string'
      ? target
      : ((target as Record<string, string>).import ?? (target as Record<string, string>).default)
  if (typeof raw !== 'string') throw new CwError('PRECONDITION', `${name}: export ${subpath} has no import/default target`)
  const rel = raw.replace(/^\.\//, '')
  if (!rel.endsWith('.js')) {
    return { specifier, subpath, kind: 'asset', source: rel }
  }
  const stem = rel.replace(/^dist\//, 'src/').replace(/\.js$/, '')
  for (const ext of TS_FOR_JS) {
    if (await exists(path.join(treeRoot, dir, stem + ext))) {
      return { specifier, subpath, kind: 'js', source: stem + ext }
    }
  }
  throw new CwError('PRECONDITION', `${name}: export ${subpath} (${raw}) has no source at ${dir}/${stem}.ts(x)`)
}

/**
 * The files a standalone client repo needs, starting at `apps/site`.
 *
 * Follows every import the TypeScript parser finds (type-only ones too: the
 * client repo runs `tsc`), resolves `@makleri/*` through each package's
 * `exports` and relative imports on disk, and records every bare external.
 * Non-JS imports of a package (the theme stylesheet, the shared tsconfig
 * base) are found in CSS `@import`s and tsconfig `extends`; a stylesheet
 * brings its whole directory, since it may `url()` siblings.
 *
 * A reached package brings every public JS entry of its exports map except
 * test helpers. Tests, fixtures and conformance code are never followed into: if shipped
 * code imports them, that is a template bug and the export stops.
 */
export async function computeClosureInTree(treeRoot: string): Promise<Closure> {
  const pkgs = await loadWorkspacePackages(treeRoot)
  const files = new Set<string>()
  const usedPkgs = new Set<string>()
  const externals: Record<string, string> = {}
  const queue: string[] = []

  const add = (rel: string, from: string) => {
    if (files.has(rel)) return
    if (!rel.startsWith(`${SITE_APP}/`) && EXCLUDED.test(rel)) {
      throw new CwError('PRECONDITION', `${from} imports ${rel}, which is test/fixture/conformance code and is not exported`)
    }
    files.add(rel)
    queue.push(rel)
  }

  const pkgDirOf = (rel: string) => {
    for (const p of pkgs.values()) if (rel.startsWith(`${p.dir}/`)) return p
    return undefined
  }

  const resolveWorkspace = async (spec: string, from: string) => {
    const pkg = pkgs.get(packageNameOf(spec))!
    const entry = pkg.exports.find((e) => e.specifier === spec)
    if (!entry) throw new CwError('PRECONDITION', `${from}: ${spec} is not in ${pkg.name}'s exports map`)
    if (!usedPkgs.has(pkg.name)) {
      usedPkgs.add(pkg.name)
      // A package arrives with its whole public JS surface (minus test
      // helpers), not just the entries the site happens to import today: the
      // tsconfig paths then mirror the exports map 1:1, and a client edit that
      // imports another public entry keeps working.
      for (const e of pkg.exports) {
        if (e.kind === 'js' && !EXCLUDED.test(e.source)) add(`${pkg.dir}/${e.source}`, `${pkg.name} exports`)
      }
    }
    const rel = `${pkg.dir}/${entry.source}`
    if (entry.kind === 'asset' && rel.endsWith('.css')) {
      const cssDir = path.posix.dirname(rel)
      for (const f of await listFiles(treeRoot, cssDir)) add(f, from)
    } else {
      if (!(await exists(path.join(treeRoot, rel)))) throw new CwError('PRECONDITION', `${from}: ${spec} → ${rel} does not exist`)
      add(rel, from)
    }
  }

  const resolveRelative = async (spec: string, from: string) => {
    const base = path.posix.join(path.posix.dirname(from), spec)
    const candidates = spec.endsWith('.js')
      ? [...TS_FOR_JS.map((ext) => base.slice(0, -3) + ext), base]
      : PROBE_SUFFIXES.map((s) => base + s)
    for (const c of candidates) {
      if (await exists(path.join(treeRoot, c))) {
        const owner = pkgDirOf(from)?.dir ?? SITE_APP
        if (!c.startsWith(`${owner}/`)) {
          throw new CwError('PRECONDITION', `${from}: relative import ${spec} leaves ${owner}; use the package's exports instead`)
        }
        add(c, from)
        return
      }
    }
    throw new CwError('PRECONDITION', `${from}: cannot resolve ${spec}`)
  }

  const handle = async (spec: string, from: string) => {
    if (isRelative(spec)) return resolveRelative(spec, from)
    if (spec.startsWith('node:') || BUILTINS.has(spec)) return
    const name = packageNameOf(spec)
    if (pkgs.has(name)) return resolveWorkspace(spec, from)
    const importer = pkgDirOf(from)?.dir ?? SITE_APP
    externals[name] ??= importer
  }

  // Seed: every tracked file of the app (it becomes the repo root as-is).
  for (const f of await listFiles(treeRoot, SITE_APP)) {
    if (/\.tsbuildinfo$|(^|\/)next-env\.d\.ts$/.test(f)) continue
    add(f, SITE_APP)
  }

  while (queue.length > 0) {
    const rel = queue.shift()!
    const abs = path.join(treeRoot, rel)
    if (CODE.test(rel) && !rel.endsWith('.d.ts')) {
      const src = await fs.readFile(abs, 'utf8')
      for (const s of findSpecifiers(src, rel)) await handle(s.text, rel)
    } else if (rel.endsWith('.css')) {
      const src = await fs.readFile(abs, 'utf8')
      for (const m of src.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1]!
        if (/^(https?:)?\/\//.test(spec)) continue
        await handle(spec, rel)
      }
    } else if (/(^|\/)tsconfig[^/]*\.json$/.test(rel) && rel.startsWith(`${SITE_APP}/`)) {
      const ext = (JSON.parse(await fs.readFile(abs, 'utf8')) as { extends?: string | string[] }).extends
      for (const e of [ext ?? []].flat()) if (e.startsWith('@makleri/')) await handle(e, rel)
    }
  }

  return {
    files: [...files].sort(),
    packages: [...usedPkgs].sort().map((n) => pkgs.get(n)!),
    externals: Object.fromEntries(Object.entries(externals).sort(([a], [b]) => a.localeCompare(b))),
    treeRoot,
  }
}

/** Where a platform-relative file lands in the client repo. */
export function outPathFor(rel: string, packages: PkgInfo[]): string {
  if (rel.startsWith(`${SITE_APP}/`)) return rel.slice(SITE_APP.length + 1)
  const pkg = packages.find((p) => rel.startsWith(`${p.dir}/`))
  if (!pkg) throw new CwError('PRECONDITION', `${rel} is outside the site and every exported package`)
  return `${pkg.outDir}/${rel.slice(pkg.dir.length + 1)}`
}
