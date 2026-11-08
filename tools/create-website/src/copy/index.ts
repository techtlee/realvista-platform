/**
 * Starter copy (`clients/<slug>/starter-copy.json`): init writes the tone
 * default, validate checks it with the schema the seed itself applies.
 *
 * The schema and defaults live in the cms template (M1,
 * `src/seed/starterCopy.ts`). We load them from the client's own backend copy,
 * so validation always matches the exact version that will seed the content,
 * and the platform never carries a second copy that could drift.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ProvisioningRequest } from '../types.js'
import { CwError } from '../types.js'

export const STARTER_COPY_FILE = 'starter-copy.json'
export const STARTER_COPY_MODULE = 'src/seed/starterCopy.ts'

export interface StarterCopyModule {
  starterCopySchema: { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }
  defaultStarterCopy(tone: 'formal' | 'friendly' | 'neutral'): unknown
}

export interface CopyIssue {
  path: string
  message: string
}

export interface CopyValidation {
  ok: boolean
  path: string
  issues: CopyIssue[]
}

export async function loadStarterCopyModule(backendDir: string): Promise<StarterCopyModule> {
  const file = join(backendDir, STARTER_COPY_MODULE)
  if (!existsSync(file)) {
    throw new CwError('TEMPLATE_TOO_OLD', `${STARTER_COPY_MODULE} is missing in ${backendDir}`, {
      hint: 'The cms template needs M1 (starter copy schema); point cmsRef at a commit that has it.',
    })
  }
  const mod = (await import(pathToFileURL(file).href)) as Partial<StarterCopyModule>
  if (!mod.starterCopySchema || !mod.defaultStarterCopy) {
    throw new CwError('TEMPLATE_TOO_OLD', `${STARTER_COPY_MODULE} does not export starterCopySchema/defaultStarterCopy`)
  }
  return mod as StarterCopyModule
}

const PLZEN_RE = /(?<!\p{L})Plz(eň|ni|ně|ní|eňsk\p{L}*)(?!\p{L})/u

/**
 * Rules the template schema cannot know because they depend on the request:
 * the tone must equal the request's (the seed refuses otherwise), the
 * client's city (client #1's Plzeň must never leak into another client) and
 * the brand being present.
 */
export function requestRules(copy: unknown, request: ProvisioningRequest): CopyIssue[] {
  const issues: CopyIssue[] = []
  const city = request.company?.city ?? ''
  const all: Array<{ path: string; value: string }> = []
  const walk = (v: unknown, p: string) => {
    if (typeof v === 'string') all.push({ path: p, value: v })
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k)
  }
  walk(copy, '')
  if (!PLZEN_RE.test(city)) {
    for (const s of all) {
      if (PLZEN_RE.test(s.value)) issues.push({ path: s.path, message: `Mentions Plzeň, but the client's city is ${city || 'not Plzeň'}. Use {city}.` })
    }
  }
  const tone = (copy as { tone?: unknown } | null)?.tone
  if (tone !== request.provisioning.content.tone) {
    issues.push({ path: 'tone', message: `tone is "${String(tone)}" but the request's content.tone is "${request.provisioning.content.tone}"; the seed refuses a mismatch.` })
  }
  const brand = request.provisioning.brand.name
  if (!all.some((s) => s.value.includes('{brand}') || s.value.includes(brand))) {
    issues.push({ path: '', message: `The brand ("${brand}") appears nowhere; use {brand} at least in the hero or about text.` })
  }
  return issues
}

export async function validateStarterCopy(o: { recordDir: string; backendDir: string; request: ProvisioningRequest }): Promise<CopyValidation> {
  const path = join(o.recordDir, STARTER_COPY_FILE)
  if (!existsSync(path)) return { ok: false, path, issues: [{ path: '', message: `${STARTER_COPY_FILE} does not exist; run \`cw copy init\`` }] }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return { ok: false, path, issues: [{ path: '', message: `not valid JSON: ${(e as Error).message}` }] }
  }
  const mod = await loadStarterCopyModule(o.backendDir)
  const r = mod.starterCopySchema.safeParse(json)
  const issues: CopyIssue[] = r.success
    ? []
    : r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
  issues.push(...requestRules(json, o.request))
  return { ok: issues.length === 0, path, issues }
}

/** Writes the tone default if the file is absent; never overwrites Claude's (or Josef's) edits. */
export async function initStarterCopy(o: { recordDir: string; backendDir: string; request: ProvisioningRequest }): Promise<{ path: string; created: boolean }> {
  const path = join(o.recordDir, STARTER_COPY_FILE)
  if (existsSync(path)) return { path, created: false }
  const mod = await loadStarterCopyModule(o.backendDir)
  const copy = mod.defaultStarterCopy(o.request.provisioning.content.tone)
  const tmp = join(dirname(path), `.${STARTER_COPY_FILE}.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(copy, null, 2) + '\n')
  renameSync(tmp, path)
  return { path, created: true }
}

export function formatIssues(issues: CopyIssue[]): string {
  return issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('\n')
}
