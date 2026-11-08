import type { toSiteConfigInput } from '@makleri/selection'

import type { PkgInfo } from './closure.js'
import { findSpecifiers } from './specifiers.js'

/** What `toSiteConfigInput` produces; `site.config.ts` and `site.urls.ts` both render from it. */
export type SiteConfigInput = ReturnType<typeof toSiteConfigInput>

/**
 * Text generators for the files the standalone commit writes or rewrites.
 * Pure functions of their arguments: same input, byte-identical output, which
 * is what lets `site-standalone` commit only when something really changed.
 */

// ---------------------------------------------------------------------------
// TypeScript literals

const IDENT = /^[A-Za-z_$][\w$]*$/

/** A single-quoted TS string literal; non-ASCII stays readable (Czech names). */
export function tsString(s: string): string {
  return `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`
}

/**
 * A value as TS source, laid out like `JSON.stringify(v, null, 2)` with bare
 * keys and single quotes: the format of the hand-made client #1 config, so the
 * generator reproduces it exactly. Unlike the prototype's regex over JSON, a
 * quote or backslash in a brand name is escaped instead of breaking the file.
 */
export function tsLiteral(v: unknown, indent = 0): string {
  const pad = ' '.repeat(indent + 2)
  const end = ' '.repeat(indent)
  if (v === null) return 'null'
  if (typeof v === 'string') return tsString(v)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`not representable: ${v}`)
    return String(v)
  }
  if (typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return `[\n${v.map((x) => pad + tsLiteral(x, indent + 2)).join(',\n')}\n${end}]`
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
    if (entries.length === 0) return '{}'
    const key = (k: string) => (IDENT.test(k) ? k : tsString(k))
    return `{\n${entries.map(([k, x]) => `${pad}${key(k)}: ${tsLiteral(x, indent + 2)}`).join(',\n')}\n${end}}`
  }
  throw new TypeError(`not representable: ${typeof v}`)
}

// ---------------------------------------------------------------------------
// site.config.ts / site.urls.ts

export interface RenderMeta {
  /** short platform sha the file was generated from, for the header */
  platformSha7?: string
}

/**
 * `site.config.ts`: the client's selection as a literal, in the template's B2
 * shape (cw/1 20ce8fa): the CMS origin comes from `site.urls.ts`, and the file
 * throws at load if its domain-derived `siteUrl` disagrees with that file.
 *
 * Only the CMS origin and tenant id stay env-driven, because they differ
 * between local, preview and production; everything else is the selection
 * and changes only by regenerating from the CRM.
 */
export function renderSiteConfig(input: SiteConfigInput, meta: RenderMeta = {}): string {
  const { cms, ...rest } = input
  // Open the object, keep its body at indent 4, and leave it open for `cms`.
  const body = tsLiteral(rest, 2).slice(0, -'\n  }'.length)
  const from = meta.platformSha7 ? ` (platform ${meta.platformSha7})` : ''
  return `import { defineSiteConfig } from '@makleri/core/config'

import theme from './app/theme'
import { cmsUrl, siteUrl } from './site.urls'

/**
 * GENERATED from the provisioning request (CRM lead → /create-website) by
 * the create-website exporter${from}. Edit the request and
 * regenerate rather than editing this by hand.
 *
 * Only the CMS origin and tenant id are read from the environment; everything
 * else is the client's selection.
 */
const site = defineSiteConfig(
  ${body},
    cms: {
      url: cmsUrl,
      tenantId: Number(process.env.TENANT_ID ?? ${tsLiteral(cms.tenantId)}),
    },
  },
  theme,
)

// next.config.ts reads site.urls.ts instead of this file, so the two must name
// the same origin. Fails the build rather than shipping a sitemap, canonical
// links and image origins that disagree with the site's own config.
if (site.siteUrl !== siteUrl) {
  throw new Error(
    \`site.urls.ts siteUrl "\${siteUrl}" does not match site.config.ts ("\${site.siteUrl}", from domain). Regenerate both.\`,
  )
}

export default site
`
}

/** The canonical origin, derived from `domain` exactly as `defineSiteConfig` does. */
export const siteUrlFor = (input: Pick<SiteConfigInput, 'domain'>) =>
  `https://${input.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`

/**
 * `site.urls.ts` (B2): the two origins `next.config.ts` needs, as plain
 * literals with no imports, in the template's shape. Generated from the same
 * `SiteConfigInput` as `site.config.ts`, which checks the two agree.
 */
export function renderSiteUrls(o: { siteUrl: string; cmsUrlDefault: string }): string {
  return `/**
 * The two origins Next.js itself needs at build time, as plain literals.
 * GENERATED with site.config.ts from the same provisioning request.
 *
 * \`next.config.ts\` imports this file and nothing else from the site, because
 * Next loads \`next.config.ts\` with a plain require hook before the app's
 * module graph exists, and \`site.config.ts\` imports the theme's TSX sources.
 * Keep it free of imports.
 */

/** Canonical origin of the site; \`site.config.ts\` derives the same from \`domain\`. */
export const siteUrl = ${tsString(o.siteUrl)}

/** The CMS this site reads; the environment wins, so one build can point anywhere. */
export const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? ${tsString(o.cmsUrlDefault)}
`
}

/**
 * `next.config.ts`: the template's file with its `@makleri/config` import
 * made relative. Next loads it without tsconfig `paths`, so the alias would
 * not resolve; everything else (the B2 `./site.urls` import) stays as written.
 */
export function renderNextConfig(template: string, configPkg: Pick<PkgInfo, 'name' | 'outDir'>): string {
  const refs = findSpecifiers(template, 'next.config.ts')
  const hit = refs.filter((r) => r.text === configPkg.name)
  if (hit.length === 0) throw new Error(`next.config.ts does not import ${configPkg.name}`)
  if (refs.some((r) => /(^|\/)site\.config(\.ts)?$/.test(r.text))) {
    throw new Error('next.config.ts imports site.config.ts; the template must read site.urls.ts (B2)')
  }
  const leftover = refs.find((r) => r.text.startsWith('@makleri/') && r.text !== configPkg.name)
  if (leftover) throw new Error(`next.config.ts imports ${leftover.text}, which Next cannot resolve without tsconfig paths`)
  let out = template
  for (const r of [...hit].reverse()) out = out.slice(0, r.start) + `./${configPkg.outDir}/src/index` + out.slice(r.end)
  return out
}

// ---------------------------------------------------------------------------
// globals.css

/**
 * Points the stylesheet import and Tailwind's class scan at the in-repo theme.
 * Tailwind v4 scans only this repo's own files, and the theme's sources live
 * under src/makleri/; without the @source every theme class is purged.
 */
export function renderGlobalsCss(theme: Pick<PkgInfo, 'outDir' | 'exports'>): string {
  const css = theme.exports.find((e) => e.kind === 'asset' && e.source.endsWith('.css'))
  if (!css) throw new Error('theme package exports no stylesheet')
  return `@import '../${theme.outDir}/${css.source}';

/* Tailwind v4 only scans this repo's own files for classes, and the theme's
 * sources live under ${theme.outDir.split('/').slice(0, -1).join('/')}/. Without this line every theme class is
 * purged and the site renders unstyled. */
@source "../${theme.outDir}/src";
`
}

// ---------------------------------------------------------------------------
// .env.example

export function renderEnvExample(o: { slug: string; backendPort: number; tenantId?: number }): string {
  return `# Origin of this client's backend (admin.<client>.cz). Local: backend-${o.slug} on ${o.backendPort}.
NEXT_PUBLIC_CMS_URL=http://localhost:${o.backendPort}
# Tenant this site belongs to, and a read-only API key scoped to it.
# Mint in the backend repo: TENANT_SLUG=${o.slug} CMS_PROBE_URL=<backend origin> pnpm seed:site-key
TENANT_ID=${o.tenantId ?? ''}
CMS_API_KEY=

# Preview-only colour switcher. A real client site leaves this unset.
NEXT_PUBLIC_VARIANT_PREVIEW=

# Must equal the backend tenant's revalidateSecret; the backend calls
# /api/revalidate with it whenever content changes.
REVALIDATE_SECRET=
`
}

// ---------------------------------------------------------------------------
// package.json / tsconfig.json

export interface RenderPackageJsonInput {
  slug: string
  sitePort: number
  deps: Record<string, string>
  devDeps: Record<string, string>
  /** from the platform root package.json, so the client builds with the same tools */
  packageManager?: string
  engines?: Record<string, string>
  /** the template's scripts; `--port ${PORT:-N}` defaults are replaced */
  scripts?: Record<string, string>
}

const sortKeys = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

export function renderPackageJson(o: RenderPackageJsonInput): string {
  const scripts: Record<string, string> = {}
  const base = o.scripts ?? { dev: 'next dev --port ${PORT:-3001}', build: 'next build', start: 'next start --port ${PORT:-3001}' }
  for (const [k, v] of Object.entries(base)) scripts[k] = v.replace(/\$\{PORT:-\d+\}/g, `\${PORT:-${o.sitePort}}`)
  scripts.typecheck ??= 'tsc --noEmit'
  const pkg = {
    name: `site-${o.slug}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    ...(o.packageManager ? { packageManager: o.packageManager } : {}),
    ...(o.engines ? { engines: o.engines } : {}),
    scripts,
    dependencies: sortKeys(o.deps),
    devDependencies: sortKeys(o.devDeps),
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}

export interface TsconfigJson {
  $schema?: string
  extends?: string | string[]
  compilerOptions?: Record<string, unknown>
  include?: string[]
  exclude?: string[]
  [k: string]: unknown
}

/** Options that only make sense when emitting a package's dist/. */
const EMIT_ONLY = new Set(['declaration', 'declarationMap', 'sourceMap', 'outDir', 'rootDir', 'composite', 'emitDeclarationOnly'])

/**
 * F4: the shared base inlined, `jsx: react-jsx` (what Next 16 forces anyway,
 * so its first build does not rewrite the file), `@makleri/*` mapped to the
 * flattened sources exactly as each package's exports map lists them, and
 * Next 16's `.next/dev/types` included.
 *
 * `site` is the app's own tsconfig (its `plugins`, `paths`, `include`).
 */
export function buildTsconfig(base: TsconfigJson, packages: PkgInfo[], site: TsconfigJson = {}): TsconfigJson {
  const compilerOptions: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base.compilerOptions ?? {})) if (!EMIT_ONLY.has(k)) compilerOptions[k] = v
  const siteOpts = { ...site.compilerOptions }
  const sitePaths = (siteOpts.paths ?? {}) as Record<string, string[]>
  delete siteOpts.paths
  Object.assign(compilerOptions, siteOpts)
  compilerOptions.jsx = 'react-jsx'
  compilerOptions.noEmit = true
  // keep noEmit next to the other flags, before plugins/paths
  const { plugins, ...flags } = compilerOptions
  const paths: Record<string, string[]> = { ...sitePaths }
  for (const [spec, target] of pathsFromExports(packages)) paths[spec] = [target]
  const include = [...new Set([...(site.include ?? ['**/*.ts', '**/*.tsx']), '.next/types/**/*.ts', '.next/dev/types/**/*.ts'])]
  const exclude = (base.exclude ?? ['node_modules', '.next']).filter((e) => e !== 'dist')
  return {
    $schema: base.$schema ?? 'https://json.schemastore.org/tsconfig',
    compilerOptions: { ...flags, ...(plugins ? { plugins } : {}), paths },
    include,
    exclude,
  }
}

/** `[specifier, ./src/makleri/<pkg>/<source>]` for every JS export, sorted by specifier. */
export function pathsFromExports(packages: PkgInfo[]): [string, string][] {
  const out: [string, string][] = []
  for (const p of packages) {
    for (const e of p.exports) {
      if (e.kind !== 'js' || /(^|\/)(tests?|fixtures|conformance)(\/|$)/.test(e.source)) continue
      out.push([e.specifier, `./${p.outDir}/${e.source}`])
    }
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}
