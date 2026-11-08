import { describe, expect, it } from 'vitest'

import {
  buildProvisioningRequest,
  catalogEntry,
  createProvisioningRequestSchema,
  RESERVED_SLUGS,
  SITE_SLUG,
  type Catalog,
  type ProvisioningRequestInput,
} from '../src/index.js'
import { provisioningRequestSchema } from '../src/registry.js'

const catalog: Catalog = [
  catalogEntry({
    name: 'realvista',
    label: 'REALVISTA',
    version: '0.1.0',
    variants: [
      { value: 'indigo', label: { cs: 'Indigová' }, swatch: '#0d0053' },
      { value: 'clay', label: { cs: 'Hliněná' } },
    ],
    sections: { home: ['hero', 'featured', 'services', 'agent', 'stats', 'contact', 'blog'] },
  }),
]

const schema = createProvisioningRequestSchema(catalog)

/** Client #1's provisioning JSON, as the CRM served it. */
const provisioning = () => ({
  schemaVersion: 1 as const,
  capturedAt: '2026-11-08T09:00:00.000Z',
  theme: { name: 'realvista', variant: 'clay' },
  modules: { blog: true, services: true, listingMap: true, mortgageCalculator: true, references: false },
  sections: { home: ['hero', 'agent', 'featured', 'stats', 'services', 'blog', 'contact'] },
  brand: { name: 'Novák Reality', tagline: 'Prodáváme domovy' },
  content: { tone: 'formal' as const, locale: 'cs-CZ' as const },
  domain: { situation: 'have-access' as const, name: 'novak-test.cz', registrar: 'wedos' as const, emailOnDomain: 'yes' as const },
  plan: { tier: 'standard' as const, billingPeriod: 'yearly' as const },
})

const valid = (): ProvisioningRequestInput => ({
  requestVersion: 1,
  slug: 'novak-test',
  crm: { leadId: 1, siteId: 1, url: 'http://localhost:3003' },
  contact: { name: 'Jan Novák', email: 'jan.novak@novak-test.cz', phone: '+420 600 000 111' },
  company: { name: 'Novák Reality s.r.o.', ico: '12345678', city: 'Plzeň' },
  provisioning: provisioning(),
})

/** Issue paths, joined, so a test says exactly which field failed. */
function issues(input: unknown) {
  const r = schema.safeParse(input)
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
}

describe('provisioning request envelope', () => {
  it('accepts a complete envelope', () => {
    expect(issues(valid())).toEqual([])
  })

  it('accepts the minimum: version, slug, contact, provisioning', () => {
    const { crm: _c, company: _co, ...min } = valid()
    expect(issues({ ...min, contact: { name: 'Jan Novák', email: 'jan@novak.cz' } })).toEqual([])
  })

  it('rejects any other request version', () => {
    expect(issues({ ...valid(), requestVersion: 2 })).toEqual(['requestVersion'])
  })

  it('is strict at the top and in every sub-object', () => {
    expect(issues({ ...valid(), extra: 1 })).toEqual([''])
    expect(issues({ ...valid(), contact: { ...valid().contact, password: 'x' } })).toEqual(['contact'])
    expect(issues({ ...valid(), company: { city: 'Brno', street: 'x' } })).toEqual(['company'])
    expect(issues({ ...valid(), crm: { leadId: 1, siteId: 1, token: 'x' } })).toEqual(['crm'])
  })

  describe('slug', () => {
    it.each(['novak-test', 'a', 'svoboda-reality-2', 'x'.repeat(63)])('accepts %s', (slug) => {
      expect(issues({ ...valid(), slug })).toEqual([])
    })

    it.each(['Novak', '-novak', 'novak-', 'novák', 'novak_test', 'novak.test', '', 'x'.repeat(64)])(
      'rejects %j',
      (slug) => {
        expect(issues({ ...valid(), slug })).toEqual(['slug'])
      },
    )

    it.each([...RESERVED_SLUGS])('rejects the reserved slug %s', (slug) => {
      const r = schema.safeParse({ ...valid(), slug })
      expect(r.success).toBe(false)
      expect(r.error?.issues[0]?.message).toMatch(/reserved/i)
    })

    it('is a DNS label, the same rule as the CRM', () => {
      expect(SITE_SLUG.source).toBe('^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
    })
  })

  describe('contact', () => {
    it('requires a name and an email', () => {
      expect(issues({ ...valid(), contact: { email: 'jan@novak.cz' } })).toEqual(['contact.name'])
      expect(issues({ ...valid(), contact: { name: 'Jan Novák' } })).toEqual(['contact.email'])
    })

    it('rejects an invalid email', () => {
      expect(issues({ ...valid(), contact: { name: 'Jan Novák', email: 'jan@' } })).toEqual(['contact.email'])
    })
  })

  describe('company', () => {
    it('checks the IČO format', () => {
      expect(issues({ ...valid(), company: { ico: '1234' } })).toEqual(['company.ico'])
    })
  })

  describe('crm', () => {
    it('needs positive integer ids', () => {
      expect(issues({ ...valid(), crm: { leadId: 0, siteId: 1.5 } })).toEqual(['crm.leadId', 'crm.siteId'])
    })

    it('takes only an http(s) url', () => {
      expect(issues({ ...valid(), crm: { leadId: 1, siteId: 1, url: 'ftp://crm' } })).toEqual(['crm.url'])
    })
  })

  describe('provisioning', () => {
    it('is the strict provisioning JSON: unknown colourway, reported at its own path', () => {
      const p = provisioning()
      const r = schema.safeParse({ ...valid(), provisioning: { ...p, theme: { name: 'realvista', variant: 'purple' } } })
      expect(r.success).toBe(false)
      expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(['provisioning.theme.variant'])
      expect(r.error?.issues[0]?.message).toContain('indigo, clay')
    })

    it('requires domain and plan', () => {
      const { domain: _d, plan: _p, ...p } = provisioning()
      expect(issues({ ...valid(), provisioning: p })).toEqual(['provisioning.domain', 'provisioning.plan'])
    })

    it('rejects duplicated and unknown sections', () => {
      const p = { ...provisioning(), sections: { home: ['hero', 'hero', 'gallery'] } }
      expect(issues({ ...valid(), provisioning: p })).toEqual(['provisioning.sections.home.1', 'provisioning.sections.home.2'])
    })

    it('carries no contact data: personal keys inside it are refused', () => {
      const p = { ...provisioning(), contact: { email: 'jan@novak.cz' } }
      expect(issues({ ...valid(), provisioning: p })).toEqual(['provisioning'])
    })
  })
})

describe('buildProvisioningRequest', () => {
  it('wraps a bare provisioning JSON into a valid envelope', () => {
    const built = buildProvisioningRequest({
      slug: 'novak-test',
      contact: { name: 'Jan Novák', email: 'jan.novak@novak-test.cz', phone: null },
      company: { name: '', ico: null, city: 'Plzeň' },
      crm: null,
      provisioning: provisioning(),
    })
    expect(built).toEqual({
      requestVersion: 1,
      slug: 'novak-test',
      contact: { name: 'Jan Novák', email: 'jan.novak@novak-test.cz' },
      company: { city: 'Plzeň' },
      provisioning: provisioning(),
    })
    expect(issues(built)).toEqual([])
  })

  it('leaves company out entirely when every field is empty', () => {
    const built = buildProvisioningRequest({
      slug: 'novak-test',
      contact: { name: 'Jan Novák', email: 'jan@novak.cz' },
      company: { name: null, ico: '', city: undefined },
      provisioning: provisioning(),
    })
    expect('company' in built).toBe(false)
  })

  it('gives the same envelope as one written by hand, so its hash is the same', () => {
    const built = buildProvisioningRequest({
      slug: valid().slug,
      contact: valid().contact,
      company: valid().company,
      crm: valid().crm,
      provisioning: provisioning(),
    })
    expect(JSON.stringify(schema.parse(built))).toBe(JSON.stringify(schema.parse(valid())))
  })
})

describe('registry', () => {
  it('validates against the themes on sale today', () => {
    expect(provisioningRequestSchema.safeParse(valid()).success).toBe(true)
  })
})
