import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { createProvisioningSchema, toSiteConfigInput } from '@makleri/selection'
import { catalog } from '@makleri/selection/registry'

import { CwError, type ProvisioningRequest } from '../types.js'
import { computeClosure, outPathFor, packageNameOf, SITE_APP, type Closure, type PackageJson, type PkgInfo } from './closure.js'
import { pinDependencies } from './lockfile.js'
import {
  buildTsconfig,
  renderEnvExample,
  renderGlobalsCss,
  renderNextConfig,
  renderPackageJson,
  renderSiteConfig,
  renderSiteUrls,
  siteUrlFor,
  type SiteConfigInput,
  type TsconfigJson,
} from './render.js'
import { findSpecifiers, isRelative, rewriteRelativeJsSpecifiers } from './specifiers.js'

const execFileP = promisify(execFile)

export const TEMPLATE_TRAILER = 'Create-Website-Template'
export const STEP_TRAILER = 'Create-Website-Step'
const TEMPLATES = fileURLToPath(new URL('../templates/site/', import.meta.url))

export interface ExportSiteOptions {
  /** the platform git checkout (the tool's own repo) */
  platformRoot: string
  /** a commit-ish; resolved to a full sha once and used for everything */
  commit: string
  /** `clients/site-<slug>`; must not exist or be empty */
  outDir: string
  request: ProvisioningRequest
  ports: { site: number; backend: number }
  /** `realvista.cz`: local mode's canonical origin is `https://<slug>.<base>` */
  subdomainBase: string
  /** names the temp dir (`.cw-tmp-<runId>-site`) so `recover` can find it */
  runId?: string
  /** `TENANT_ID` fallback baked into site.config.ts; the env wins at runtime */
  tenantId?: number
}

export interface ExportReport {
  outDir: string
  platformCommit: string
  commits: { pristine: string; standalone: string }
  files: number
  packages: string[]
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  siteConfig: SiteConfigInput
  siteUrl: string
  cmsUrlDefault: string
}

/** Validates the request's selection and maps it the way the CRM preview does. */
export function siteConfigInputFor(
  request: Pick<ProvisioningRequest, 'slug' | 'provisioning'>,
  o: { subdomainBase: string; tenantId?: number },
): SiteConfigInput {
  const parsed = createProvisioningSchema(catalog).safeParse(request.provisioning)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new CwError('INVALID_INPUT', `provisioning JSON invalid:\n  ${issues.join('\n  ')}`, { details: issues })
  }
  const { slug } = request
  return toSiteConfigInput(parsed.data, {
    siteId: slug,
    cms: { url: `https://admin.${slug}.${o.subdomainBase}`, tenantId: o.tenantId ?? 1 },
    platformSubdomain: `${slug}.${o.subdomainBase}`,
    // Local mode serves the platform subdomain; the own domain goes live only
    // once its DNS points at the deployment (outward plan), then regenerate.
    customDomainLive: false,
  })
}

/**
 * `site-copy` + `site-standalone` (runbook step 11): a standalone client repo
 * from `apps/site` at one platform commit.
 *
 * Two commits, so the client-specific part is a reviewable diff on top of the
 * pristine template. The repo is built in a sibling temp dir and renamed into
 * place, so `outDir` is either absent or complete, never half-written.
 */
export async function exportSite(o: ExportSiteOptions): Promise<ExportReport> {
  if (await nonEmptyDir(o.outDir)) {
    throw new CwError('TARGET_EXISTS', `${o.outDir} already exists and is not empty`, {
      hint: 'Inspect it, or move it away yourself; the exporter never overwrites a directory.',
    })
  }
  const sha = (await git(o.platformRoot, ['rev-parse', '--verify', `${o.commit}^{commit}`])).trim()
  const siteConfig = siteConfigInputFor(o.request, o)
  const tmp = path.join(path.dirname(o.outDir), `.cw-tmp-${o.runId ?? randomBytes(4).toString('hex')}-site`)
  await fs.rm(tmp, { recursive: true, force: true })
  await fs.mkdir(path.dirname(o.outDir), { recursive: true })

  const closure = await computeClosure(o.platformRoot, sha)
  try {
    await fs.mkdir(tmp)
    await copyPristine(closure, tmp)
    await git(tmp, ['init', '-q', '-b', 'main'])
    const pristine = await commitAll(
      tmp,
      `Copy of the REALVISTA site template (platform ${sha.slice(0, 7)})`,
      `${SITE_APP} plus the sources of ${closure.packages.map((p) => p.name.replace(/^@makleri\//, '')).join(', ')},\n` +
        `flattened under src/makleri/. Unmodified, so every client-specific and\n` +
        `standalone-making change after this commit is a visible diff.`,
      `${TEMPLATE_TRAILER}: platform@${sha}`,
    )

    const deps = await planDependencies(closure)
    const sa = await makeStandalone(closure, tmp, { ...o, sha, siteConfig, deps })
    const standalone = await commitAll(
      tmp,
      `Make the copy standalone and configure it for ${o.request.slug}`,
      [
        '- package.json: pinned registry deps only (versions from the platform lockfile), no workspace:/link:.',
        '- tsconfig: the shared base inlined; @makleri/* resolved by paths to the',
        '  flattened sources under src/makleri/, mirroring each exports map.',
        '- Relative imports lose their .js suffix (TypeScript AST rewrite): Turbopack',
        '  does not map ./x.js to ./x.ts, and the template consumed compiled dist/.',
        '- next.config.ts: @makleri/config made relative (Next loads it without tsconfig paths).',
        '- globals.css points @import/@source at the in-repo theme.',
        '- site.config.ts and site.urls.ts generated from the provisioning request.',
      ].join('\n'),
      `${STEP_TRAILER}: site-standalone`,
    )

    await fs.rename(tmp, o.outDir).catch(async (err: NodeJS.ErrnoException) => {
      // rename onto an existing empty dir fails on some platforms
      if (err.code !== 'ENOTEMPTY' && err.code !== 'EEXIST') throw err
      await fs.rmdir(o.outDir)
      await fs.rename(tmp, o.outDir)
    })

    return {
      outDir: o.outDir,
      platformCommit: sha,
      commits: { pristine, standalone },
      files: sa.files,
      packages: closure.packages.map((p) => p.name),
      dependencies: deps.dependencies,
      devDependencies: deps.devDependencies,
      siteConfig,
      siteUrl: siteUrlFor(siteConfig),
      cmsUrlDefault: siteConfig.cms.url,
    }
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    throw err
  } finally {
    await fs.rm(closure.treeRoot, { recursive: true, force: true })
  }
}

/** Copies every closure file to its flattened location, byte for byte. */
export async function copyPristine(closure: Closure, into: string): Promise<void> {
  for (const rel of closure.files) {
    const to = path.join(into, outPathFor(rel, closure.packages))
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.copyFile(path.join(closure.treeRoot, rel), to)
  }
}

export interface PlannedDeps {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const typesPackageFor = (name: string) => `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`

/**
 * The client repo's dependencies.
 *
 * - The site's own registry deps keep their dependencies/devDependencies split.
 * - Every other external the copied sources import (zod from core) becomes a
 *   dependency.
 * - A runtime dependency whose `@types/*` a copied package used to compile
 *   against (react-dom) brings it along as a devDependency.
 *
 * Every version is the one the platform lockfile resolved, so the client
 * builds with what the template was tested with.
 */
export async function planDependencies(closure: Closure): Promise<PlannedDeps> {
  const sitePkg = JSON.parse(await fs.readFile(path.join(closure.treeRoot, SITE_APP, 'package.json'), 'utf8')) as PackageJson
  const workspace = new Set(closure.packages.map((p) => p.name))
  const registry = (deps: Record<string, string> | undefined) =>
    Object.keys(deps ?? {}).filter((n) => !workspace.has(n) && !/^(workspace|link|file):/.test(deps![n]!))
  const depNames = new Set(registry(sitePkg.dependencies))
  const devNames = new Set(registry(sitePkg.devDependencies))
  for (const name of Object.keys(closure.externals)) {
    if (!depNames.has(name) && !devNames.has(name) && !workspace.has(packageNameOf(name))) depNames.add(name)
  }
  const declared = (p: PkgInfo) => ({ ...p.packageJson.dependencies, ...p.packageJson.devDependencies })
  for (const name of depNames) {
    const types = typesPackageFor(name)
    if (depNames.has(types) || devNames.has(types)) continue
    if (closure.packages.some((p) => types in declared(p))) devNames.add(types)
  }
  const lock = await fs.readFile(path.join(closure.treeRoot, 'pnpm-lock.yaml'), 'utf8')
  const importers = [SITE_APP, ...closure.packages.map((p) => p.dir)]
  const pinned = pinDependencies(lock, importers, [...depNames, ...devNames])
  const pick = (names: Set<string>) => Object.fromEntries([...names].sort().map((n) => [n, pinned[n]!]))
  return { dependencies: pick(depNames), devDependencies: pick(devNames) }
}

interface StandaloneInput extends ExportSiteOptions {
  sha: string
  siteConfig: SiteConfigInput
  deps: PlannedDeps
}

/** Applies every standalone rewrite inside `dir` (a pristine copy). Returns the tracked file count. */
export async function makeStandalone(closure: Closure, dir: string, o: StandaloneInput): Promise<{ files: number }> {
  const write = async (rel: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await fs.writeFile(path.join(dir, rel), content)
  }
  const read = (rel: string) => fs.readFile(path.join(dir, rel), 'utf8')

  // B3: relative `.js` specifiers, in every copied source file.
  for (const rel of closure.files) {
    if (!/\.(tsx?|mts|jsx?|mjs)$/.test(rel) || rel.endsWith('.d.ts')) continue
    const out = outPathFor(rel, closure.packages)
    const src = await read(out)
    const next = rewriteRelativeJsSpecifiers(src, out)
    if (next !== src) await write(out, next)
  }

  // tsconfig: inline the base the site extended, then drop the copied base.
  const siteTs = JSON.parse(await read('tsconfig.json')) as TsconfigJson
  let base: TsconfigJson = {}
  for (const ext of [siteTs.extends ?? []].flat()) {
    const pkg = closure.packages.find((p) => ext.startsWith(`${p.name}/`))
    const entry = pkg?.exports.find((e) => e.specifier === ext)
    if (!pkg || !entry) throw new CwError('PRECONDITION', `tsconfig extends ${ext}, which no exported package provides`)
    const copied = `${pkg.outDir}/${entry.source}`
    base = { ...base, ...(JSON.parse(await read(copied)) as TsconfigJson) }
    await fs.rm(path.join(dir, copied))
  }
  await write('tsconfig.json', `${JSON.stringify(buildTsconfig(base, closure.packages, siteTs), null, 2)}\n`)

  // package.json: the template's scripts, the platform's toolchain pins.
  const sitePkg = JSON.parse(await read('package.json')) as PackageJson
  const rootPkg = JSON.parse(await fs.readFile(path.join(closure.treeRoot, 'package.json'), 'utf8')) as PackageJson
  await write(
    'package.json',
    renderPackageJson({
      slug: o.request.slug,
      sitePort: o.ports.site,
      deps: o.deps.dependencies,
      devDeps: o.deps.devDependencies,
      packageManager: rootPkg.packageManager as string | undefined,
      engines: (rootPkg.engines as Record<string, string> | undefined) ?? { node: '>=22' },
      scripts: sitePkg.scripts as Record<string, string> | undefined,
    }),
  )

  // B2: next.config.ts never imports site.config.ts.
  const configPkg = closure.packages.find((p) => p.name === '@makleri/config')
  if (!configPkg) throw new CwError('PRECONDITION', 'the site does not use @makleri/config; next.config.ts cannot be generated')
  await write('next.config.ts', renderNextConfig(await read('next.config.ts'), configPkg))
  const urls = { siteUrl: siteUrlFor(o.siteConfig), cmsUrlDefault: o.siteConfig.cms.url }
  await write('site.urls.ts', renderSiteUrls(urls))
  await write('site.config.ts', renderSiteConfig(o.siteConfig, { platformSha7: o.sha.slice(0, 7) }))

  // globals.css: the theme whose stylesheet the template imports.
  const globals = await read('app/globals.css')
  const themeSpec = /@import\s+['"](@makleri\/[^'"]+\.css)['"]/.exec(globals)?.[1]
  const theme = themeSpec ? closure.packages.find((p) => p.name === packageNameOf(themeSpec)) : undefined
  if (!theme) throw new CwError('PRECONDITION', 'app/globals.css imports no @makleri theme stylesheet')
  await write('app/globals.css', renderGlobalsCss(theme))

  await write('.env.example', renderEnvExample({ slug: o.request.slug, backendPort: o.ports.backend, tenantId: o.tenantId ?? 1 }))
  await write('.gitignore', await fs.readFile(path.join(TEMPLATES, 'gitignore'), 'utf8'))
  await write('.github/dependabot.yml', await fs.readFile(path.join(TEMPLATES, 'dependabot.yml'), 'utf8'))
  await write(
    'README.md',
    fill(await fs.readFile(path.join(TEMPLATES, 'README.md'), 'utf8'), {
      slug: o.request.slug,
      brandName: o.siteConfig.brand?.name ?? o.request.slug,
      platformSha7: o.sha.slice(0, 7),
      sitePort: String(o.ports.site),
      backendPort: String(o.ports.backend),
    }),
  )

  await assertStandalone(dir)
  return { files: (await git(dir, ['ls-files', '--others', '--cached', '--exclude-standard'])).split('\n').filter(Boolean).length }
}

/**
 * The repo stands alone: package.json has no workspace:/link:/file: or `../`
 * spec, every relative import resolves inside the repo without a `.js`
 * suffix, and every `@makleri/*` import has a tsconfig path. Cheap, and it
 * turns a template change the exporter does not understand into an export
 * error instead of a client build failure.
 */
export async function assertStandalone(dir: string): Promise<void> {
  const problems: string[] = []
  const pj = await fs.readFile(path.join(dir, 'package.json'), 'utf8')
  if (/"(workspace|link|file):|"\.\.\//.test(pj)) problems.push('package.json: workspace:/link:/file: or ../ dependency')
  const paths = ((JSON.parse(await fs.readFile(path.join(dir, 'tsconfig.json'), 'utf8')) as TsconfigJson).compilerOptions?.paths ?? {}) as Record<string, string[]>
  const files = (await git(dir, ['ls-files', '--others', '--cached', '--exclude-standard'])).split('\n').filter((f) => /\.(tsx?|mts|mjs)$/.test(f))
  for (const f of files) {
    for (const s of findSpecifiers(await fs.readFile(path.join(dir, f), 'utf8'), f)) {
      if (isRelative(s.text)) {
        const target = path.resolve(dir, path.dirname(f), s.text)
        if (!target.startsWith(dir + path.sep)) problems.push(`${f}: ${s.text} leaves the repo`)
        else if (s.text.endsWith('.js')) problems.push(`${f}: ${s.text} keeps its .js suffix`)
        else if (!(await resolvesTs(target))) problems.push(`${f}: ${s.text} does not resolve`)
      } else if (s.text.startsWith('@makleri/') && !paths[s.text]) {
        problems.push(`${f}: ${s.text} has no tsconfig path`)
      }
    }
  }
  if (problems.length > 0) {
    throw new CwError('PRECONDITION', `the exported site is not standalone:\n  ${problems.join('\n  ')}`, { details: problems })
  }
}

async function resolvesTs(target: string): Promise<boolean> {
  for (const suffix of ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx']) {
    const st = await fs.stat(target + suffix).catch(() => null)
    if (st?.isFile()) return true
  }
  return false
}

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)

async function nonEmptyDir(p: string): Promise<boolean> {
  try {
    return (await fs.readdir(p)).length > 0
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') return true
    throw err
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

/** Commits everything; falls back to a tool identity only where git has none configured. */
async function commitAll(dir: string, subject: string, body: string, trailer: string): Promise<string> {
  await git(dir, ['add', '-A'])
  const identity = (await git(dir, ['config', 'user.email']).catch(() => '')).trim()
    ? []
    : ['-c', 'user.name=create-website', '-c', 'user.email=create-website@localhost']
  await execFileP('git', ['-C', dir, ...identity, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject, '-m', body, '-m', trailer])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}
