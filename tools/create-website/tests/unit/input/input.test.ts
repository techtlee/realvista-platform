import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadInput, validateOrThrow, validateRequest } from '../../../src/input/load.js'
import { slugifyCzech } from '../../../src/input/slug.js'
import { tmp } from '../../helpers/tmp.js'

const FIXTURE = join(import.meta.dirname, 'fixtures/svoboda.request.json')
const valid = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, any>

const issuesOf = (raw: unknown) => {
  const r = validateRequest(raw)
  return r.ok ? [] : r.issues
}

describe('request validation', () => {
  it('accepts the fixture envelope', () => {
    const r = validateRequest(valid())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.request.slug).toBe('svoboda-reality')
      expect(r.value.requestSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('unknown colourway → issue at provisioning.theme.variant listing the colourways', () => {
    const raw = valid()
    raw.provisioning.theme.variant = 'purple'
    const issues = issuesOf(raw)
    const i = issues.find((x) => x.path.endsWith('theme.variant'))
    expect(i, JSON.stringify(issues)).toBeDefined()
    for (const c of ['indigo', 'crimson', 'clay', 'mono']) expect(i!.message).toContain(c)
  })

  it('missing domain', () => {
    const raw = valid()
    delete raw.provisioning.domain
    expect(issuesOf(raw).map((i) => i.path)).toContain('provisioning.domain')
  })

  it('duplicate section', () => {
    const raw = valid()
    raw.provisioning.sections.home = ['hero', 'hero', 'blog']
    expect(issuesOf(raw).some((i) => i.path.startsWith('provisioning.sections.home'))).toBe(true)
  })

  it.each([['Svoboda Reality'], ['-x'], ['a'.repeat(64)], ['ščť']])('bad slug %s', (slug) => {
    const raw = valid()
    raw.slug = slug
    expect(issuesOf(raw).map((i) => i.path)).toContain('slug')
  })

  it.each([['www'], ['admin'], ['api'], ['crm'], ['demo'], ['mail']])('reserved slug %s → RESERVED_SLUG, exit 2', (slug) => {
    const raw = valid()
    raw.slug = slug
    expect(() => validateOrThrow(raw)).toThrow(expect.objectContaining({ code: 'RESERVED_SLUG', exitCode: 2 }))
  })

  it('unknown keys are errors (strict at every level)', () => {
    const raw = valid()
    raw.contact.note = 'x'
    expect(issuesOf(raw).length).toBeGreaterThan(0)
  })

  it('invalid input throws INVALID_INPUT with issues in details, exit 2', () => {
    const raw = valid()
    raw.contact.email = 'nope'
    try {
      validateOrThrow(raw)
      expect.unreachable()
    } catch (e: any) {
      expect(e.code).toBe('INVALID_INPUT')
      expect(e.exitCode).toBe(2)
      expect(e.details[0].path).toBe('contact.email')
    }
  })
})

describe('input forms', () => {
  it('bare JSON + flags builds the same sha as the envelope', async () => {
    const dir = tmp()
    const env = valid()
    delete env.crm
    const envFile = join(dir, 'req.json')
    writeFileSync(envFile, JSON.stringify(env))
    const bareFile = join(dir, 'provisioning.json')
    writeFileSync(bareFile, JSON.stringify(env.provisioning))
    const a = validateOrThrow((await loadInput({ request: envFile })).raw)
    const loaded = await loadInput({
      json: bareFile,
      slug: env.slug,
      contactName: env.contact.name,
      contactEmail: env.contact.email,
      contactPhone: env.contact.phone,
      companyName: env.company.name,
      city: env.company.city,
    })
    expect(loaded.source).toBe('bare-json')
    expect(validateOrThrow(loaded.raw).requestSha256).toBe(a.requestSha256)
  })

  it('bare JSON without slug/contact names the missing flags', async () => {
    const dir = tmp()
    const f = join(dir, 'p.json')
    writeFileSync(f, JSON.stringify(valid().provisioning))
    await expect(loadInput({ json: f })).rejects.toThrow(/--slug, --contact-name, --contact-email/)
  })

  it('a bare JSON passed as --request is explained, not just rejected', async () => {
    const dir = tmp()
    const f = join(dir, 'p.json')
    writeFileSync(f, JSON.stringify(valid().provisioning))
    await expect(loadInput({ request: f })).rejects.toThrow(/bare provisioning JSON/)
  })

  it('exactly one input form', async () => {
    await expect(loadInput({})).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(loadInput({ request: 'a', lead: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('--lead goes through the CRM client', async () => {
    const crm = { getProvisioningRequest: async (id: number) => ({ ...valid(), crm: { leadId: id, siteId: 3 } }) }
    const r = await loadInput({ lead: 12 }, { crm: crm as any })
    expect(r).toMatchObject({ source: 'crm', leadId: 12 })
    await expect(loadInput({ lead: 12 })).rejects.toMatchObject({ code: 'PRECONDITION' })
  })
})

describe('slugifyCzech', () => {
  it.each([
    ['Svoboda Reality', 'svoboda-reality'],
    ['Králová Reality s.r.o.', 'kralova-reality'],
    ['Novák & syn, a.s.', 'novak-syn'],
    ['  Žluťoučký kůň  ', 'zlutoucky-kun'],
  ])('%s → %s', (a, b) => expect(slugifyCzech(a)).toBe(b))
})
