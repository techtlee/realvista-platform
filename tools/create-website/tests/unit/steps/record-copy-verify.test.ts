import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initStarterCopy, requestRules, validateStarterCopy } from '../../../src/copy/index.js'
import { input, recordRepo, starterCopy } from '../../../src/steps/record.js'
import { relativeSpecifiers, sectionOrder, variantOf } from '../../../src/verify/checks.js'
import { verifySecrets } from '../../../src/verify/secrets.js'
import { REQUEST, git, makeWorld, type World } from './helpers.js'

let w: World
beforeEach(() => {
  w = makeWorld()
})
afterEach(() => w.cleanup())

describe('input + record-repo', () => {
  it('writes both files, then probes done', async () => {
    expect((await input.probe(w.ctx)).state).toBe('absent')
    await input.run(w.ctx)
    expect((await input.probe(w.ctx)).state).toBe('done')
  })

  it('a different request already on disk is INPUT_CHANGED, not overwritten', async () => {
    mkdirSync(w.ctx.paths.record, { recursive: true })
    writeFileSync(join(w.ctx.paths.record, 'provisioning-request.json'), JSON.stringify({ ...REQUEST, contact: { name: 'X', email: 'x@y.cz' } }))
    expect(await input.probe(w.ctx)).toMatchObject({ state: 'conflict', code: 'INPUT_CHANGED' })
  })

  it('record-repo commits once (trailer check), with logs ignored', async () => {
    await input.run(w.ctx)
    await recordRepo.run(w.ctx)
    await recordRepo.run(w.ctx)
    expect(git(w.ctx.paths.record, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
    expect(git(w.ctx.paths.record, 'ls-files')).toContain('provisioning-request.json')
    expect((await recordRepo.probe(w.ctx)).state).toBe('done')
  })
})

/** A stand-in for cms src/seed/starterCopy.ts (M1): same exports, no zod. */
const FAKE_MODULE = `
export const starterCopySchema = {
  safeParse(v) {
    const issues = []
    if (!v || v.copyVersion !== 1) issues.push({ path: ['copyVersion'], message: 'expected 1' })
    for (const s of (v && v.stats) || []) if (/\\d/.test(s.value)) issues.push({ path: ['stats'], message: 'no numbers' })
    if (JSON.stringify(v).match(/\\b(máš|napiš)\\b/)) issues.push({ path: ['hero'], message: 'tykání' })
    return issues.length ? { success: false, error: { issues } } : { success: true, data: v }
  },
}
export function defaultStarterCopy(tone) {
  return { copyVersion: 1, tone, hero: { headline: 'Vítejte u {brand}' }, stats: [{ value: '[DOPLNIT]', label: 'let v oboru' }] }
}
`

describe('starter copy', () => {
  beforeEach(() => {
    mkdirSync(join(w.ctx.paths.backend, 'src', 'seed'), { recursive: true })
    writeFileSync(join(w.ctx.paths.backend, 'src', 'seed', 'starterCopy.ts'), FAKE_MODULE)
    mkdirSync(w.ctx.paths.record, { recursive: true })
  })
  const o = () => ({ recordDir: w.ctx.paths.record, backendDir: w.ctx.paths.backend, request: REQUEST })

  it('init writes the tone default once and never overwrites edits', async () => {
    expect((await initStarterCopy(o())).created).toBe(true)
    writeFileSync(join(w.ctx.paths.record, 'starter-copy.json'), JSON.stringify({ copyVersion: 1, tone: 'friendly', hero: { headline: 'Moje {brand}' }, stats: [] }))
    expect((await initStarterCopy(o())).created).toBe(false)
    expect((await validateStarterCopy(o())).ok).toBe(true)
  })

  it('the step fails with INVALID_STARTER_COPY and lists the paths', async () => {
    writeFileSync(join(w.ctx.paths.record, 'starter-copy.json'), JSON.stringify({ copyVersion: 1, hero: { headline: 'Napiš nám, {brand}' }, stats: [{ value: '12 let' }] }))
    expect((await starterCopy.probe(w.ctx)).state).toBe('partial')
    await expect(starterCopy.run(w.ctx)).rejects.toMatchObject({ code: 'INVALID_STARTER_COPY' })
  })

  it('client #1 leftovers (Plzeň) fail for a Brno client; the brand must appear', () => {
    const issues = requestRules({ hero: { headline: 'Bydlení v Plzni' } }, REQUEST)
    expect(issues.map((i) => i.message).join('\n')).toMatch(/Plzeň/)
    expect(issues.map((i) => i.message).join('\n')).toMatch(/brand/)
    const plzen = { ...REQUEST, company: { city: 'Plzeň' } }
    expect(requestRules({ tone: 'friendly', hero: { headline: 'Svoboda Reality v Plzni' } }, plzen)).toEqual([])
  })

  it("the copy's tone must equal the request's content.tone", () => {
    const issues = requestRules({ tone: 'formal', hero: { headline: '{brand}' } }, REQUEST)
    expect(issues).toEqual([expect.objectContaining({ path: 'tone' })])
  })
})

describe('verify helpers', () => {
  it('reads data-section order and the html data-variant', () => {
    const html = '<html lang="cs" data-variant="indigo"><div data-section="hero" class="contents"></div><div data-section="agent" class="contents"></div>'
    expect(sectionOrder(html)).toEqual(['hero', 'agent'])
    expect(variantOf(html)).toBe('indigo')
  })

  it('finds relative specifiers in static, dynamic and export-from forms', () => {
    const src = `import a from './a'\nexport * from '../b'\nconst c = await import('./c')\nimport x from 'next'\nimport type { T } from './t'`
    expect(relativeSpecifiers(src)).toEqual(['./a', '../b', './c', './t'])
  })
})

describe('secrets-check (verify)', () => {
  it('flags a planted value in a tracked file, a log and the plan; passes when clean', async () => {
    mkdirSync(w.ctx.paths.backend, { recursive: true })
    git(w.ctx.paths.backend, 'init', '-q', '-b', 'main')
    writeFileSync(join(w.ctx.paths.backend, '.gitignore'), '.env\n.admin-credentials.local\n')
    await w.secrets.ensure('backend/.env', 'PAYLOAD_SECRET', () => 'planted-secret-0123456789abcdef')
    await w.secrets.ensure('backend/.env', 'DATABASE_URL', () => 'postgres://localhost:5432/cw6_backend_x_dev')
    await w.secrets.ensure('backend/.env', 'PORT', () => '4261')
    writeFileSync(join(w.ctx.paths.backend, 'ok.ts'), 'export const port = 4261 // postgres://localhost:5432/your-db\n')
    git(w.ctx.paths.backend, 'add', '-A')
    git(w.ctx.paths.backend, 'commit', '-q', '-m', 'clean')
    expect((await verifySecrets(w.ctx, w.exec)).ok).toBe(true)

    writeFileSync(join(w.ctx.paths.backend, 'leak.ts'), 'const s = "planted-secret-0123456789abcdef"\n')
    git(w.ctx.paths.backend, 'add', '-A')
    mkdirSync(join(w.ctx.paths.record, 'logs', 'run'), { recursive: true })
    writeFileSync(join(w.ctx.paths.record, 'logs', 'run', 'x.log'), 'tail: secret-01234567\n')
    writeFileSync(join(w.ctx.paths.record, 'outward-plan.md'), 'planted-secret-0123456789abcdef')
    const r = await verifySecrets(w.ctx, w.exec)
    expect(r.ok).toBe(false)
    const files = r.hits.map((h) => h.file).join(' ')
    expect(files).toContain('leak.ts')
    expect(files).toContain('x.log')
    expect(files).toContain('outward-plan.md')
    expect(JSON.stringify(r)).not.toContain('planted-secret-0123456789abcdef')
  })

  it('flags a secret file that was ever committed', async () => {
    mkdirSync(w.ctx.paths.site, { recursive: true })
    git(w.ctx.paths.site, 'init', '-q', '-b', 'main')
    writeFileSync(join(w.ctx.paths.site, '.env.local'), 'X=1\n')
    git(w.ctx.paths.site, 'add', '-A')
    git(w.ctx.paths.site, 'commit', '-q', '-m', 'oops')
    git(w.ctx.paths.site, 'rm', '-q', '--cached', '.env.local')
    git(w.ctx.paths.site, 'commit', '-q', '-m', 'remove')
    const r = await verifySecrets(w.ctx, w.exec)
    expect(r.hits.some((h) => h.file.includes('.env.local') && h.file.includes('history'))).toBe(true)
  })
})
