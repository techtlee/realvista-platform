import { describe, expect, it } from 'vitest'

import {
  buildProvisioningJson,
  catalogEntry,
  createIntakeRequestSchema,
  createIntakeSchema,
  createProvisioningSchema,
  readStoredSelection,
  toSiteConfigInput,
  UnknownSelectionVersionError,
  type Catalog,
  type SelectionV1Input,
} from '../src/index.js'
import { provisioningSchema, catalog as registry } from '../src/registry.js'

const catalog: Catalog = [
  catalogEntry({
    name: 'realvista',
    label: 'REALVISTA',
    version: '0.1.0',
    variants: [
      { value: 'indigo', label: { cs: 'Indigová' }, swatch: '#0d0053' },
      { value: 'crimson', label: { cs: 'Červená' } },
    ],
    sections: { home: ['hero', 'featured', 'services', 'agent', 'blog'] },
  }),
]

const intake = createIntakeSchema(catalog)

function valid(): SelectionV1Input {
  return {
    schemaVersion: 1,
    capturedAt: '2026-10-14T09:12:03.411Z',
    theme: { name: 'realvista', variant: 'indigo' },
    modules: { blog: true, services: true, listingMap: true, mortgageCalculator: false, references: false },
    sections: { home: ['hero', 'featured', 'services', 'blog'] },
    brand: { name: 'Novák Reality', tagline: 'Prodáváme domovy, ne nemovitosti', logo: { uploadId: null } },
    content: { tone: 'formal', locale: 'cs-CZ' },
    domain: { situation: 'have-access', name: 'NovakReality.cz', registrar: 'wedos', emailOnDomain: 'yes' },
    plan: { tier: 'standard', billingPeriod: 'yearly' },
    source: {
      page: '/galerie/realvista',
      previewedVariants: ['indigo', 'crimson'],
      utm: { source: 'seznam', medium: 'cpc', campaign: 'makleri-jaro' },
    },
  }
}

function issues(input: unknown) {
  const r = intake.safeParse(input)
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
}

describe('intake validation', () => {
  it('accepts the canonical example and normalises the domain', () => {
    const r = intake.parse(valid())
    expect(r.domain?.name).toBe('novakreality.cz')
  })

  it('rejects an unknown theme', () => {
    expect(issues({ ...valid(), theme: { name: 'nope', variant: 'indigo' } })).toEqual(['theme.name'])
  })

  it('rejects a colourway the theme does not have', () => {
    expect(issues({ ...valid(), theme: { name: 'realvista', variant: 'purple' } })).toEqual(['theme.variant'])
  })

  it('rejects unknown and duplicated section ids', () => {
    const s = valid()
    s.sections.home = ['hero', 'carousel', 'hero']
    expect(issues(s)).toEqual(['sections.home.1', 'sections.home.2'])
  })

  it('rejects a previewed colourway the theme does not have', () => {
    const s = valid()
    s.source!.previewedVariants = ['indigo', 'mint']
    expect(issues(s)).toEqual(['source.previewedVariants.1'])
  })

  it('rejects unknown keys, so a picker cannot smuggle fields past the boundary', () => {
    expect(issues({ ...valid(), status: 'approved' })).toHaveLength(1)
  })

  it('rejects a version it does not know', () => {
    expect(issues({ ...valid(), schemaVersion: 2 })).toEqual(['schemaVersion'])
  })

  it('requires a domain name unless the client has none', () => {
    const s = valid()
    delete s.domain!.name
    expect(issues(s)).toEqual(['domain.name'])
    s.domain!.situation = 'none'
    expect(issues(s)).toEqual([])
  })

  it('rejects a domain with a protocol or path', () => {
    const s = valid()
    s.domain!.name = 'https://novakreality.cz/'
    expect(issues(s)).toEqual(['domain.name'])
  })
})

describe('reading stored selections', () => {
  it('reads a v1 payload back without checking it against today’s catalog', () => {
    // A colourway retired since capture must still render in the CRM.
    const stored = { ...valid(), theme: { name: 'realvista', variant: 'retired-green' } }
    expect(readStoredSelection(stored).theme.variant).toBe('retired-green')
  })

  it('tolerates keys deprecated after capture', () => {
    expect(() => readStoredSelection({ ...valid(), legacyKey: 1 })).not.toThrow()
  })

  it('refuses an unknown version rather than guessing', () => {
    expect(() => readStoredSelection({ ...valid(), schemaVersion: 99 })).toThrow(UnknownSelectionVersionError)
    expect(() => readStoredSelection(null)).toThrow(UnknownSelectionVersionError)
  })
})

describe('toSiteConfigInput', () => {
  const facts = {
    siteId: 'novak-reality',
    cms: { url: 'https://cms.example.cz', tenantId: 7 },
    platformSubdomain: 'novak-reality.makleri.cz',
  }

  it('maps the selection onto the site config', () => {
    const cfg = toSiteConfigInput(intake.parse(valid()), { ...facts, customDomainLive: true })
    expect(cfg).toEqual({
      siteId: 'novak-reality',
      locale: 'cs-CZ',
      domain: 'novakreality.cz',
      theme: { name: 'realvista', variant: 'indigo' },
      cms: { url: 'https://cms.example.cz', tenantId: 7 },
      brand: { name: 'Novák Reality' },
      features: { blog: true, listingMap: true, mortgageCalculator: false },
      pages: { home: { sections: ['hero', 'featured', 'services', 'blog'] } },
    })
  })

  it('uses the platform subdomain until the custom domain is live', () => {
    expect(toSiteConfigInput(intake.parse(valid()), facts).domain).toBe('novak-reality.makleri.cz')
  })

  it('drops the section of a module that is switched off', () => {
    const s = valid()
    s.modules.services = false
    s.modules.blog = false
    expect(toSiteConfigInput(intake.parse(s), facts).pages).toEqual({
      home: { sections: ['hero', 'featured'] },
    })
  })

  it('never leaks CRM-only data into the site config', () => {
    const json = JSON.stringify(toSiteConfigInput(intake.parse(valid()), facts))
    for (const leak of ['standard', 'seznam', 'formal', 'Prodáváme']) expect(json).not.toContain(leak)
  })
})

describe('registry', () => {
  it('is built from the real REALVISTA manifest', () => {
    const rv = registry.find((t) => t.name === 'realvista')
    expect(rv?.variants.map((v) => v.value)).toEqual(['indigo', 'crimson', 'clay', 'mono'])
    expect(rv?.homeSections).toContain('hero')
  })

  it('accepts the theme’s own default section order', () => {
    const rv = registry[0]!
    const s = { ...valid(), sections: { home: rv.homeSections } }
    expect(createIntakeSchema(registry).safeParse(s).success).toBe(true)
  })
})

describe('intake request', () => {
  const request = createIntakeRequestSchema(catalog)
  const body = () => ({
    contact: { name: 'Jan Novák', email: 'jan@novakreality.cz', phone: '+420 777 123 456' },
    company: { ico: '27074358', name: 'Novák Reality s.r.o.' },
    portfolioSize: '6-20',
    consent: { given: true, text: 'Souhlasím se zpracováním osobních údajů za účelem nabídky.' },
    selection: valid(),
  })

  it('accepts a complete submission', () => {
    expect(request.safeParse(body()).success).toBe(true)
  })

  it('refuses a submission without consent', () => {
    expect(request.safeParse({ ...body(), consent: { given: false, text: 'x'.repeat(30) } }).success).toBe(false)
  })

  it('refuses a filled honeypot', () => {
    expect(request.safeParse({ ...body(), website: 'http://spam' }).success).toBe(false)
  })

  it('validates the nested selection against the catalog', () => {
    const b = body()
    b.selection.theme.variant = 'purple'
    expect(request.safeParse(b).success).toBe(false)
  })
})

/** What the storefront sends: no `domain`, no `plan` — the page does not ask. */
function fromStorefront(): SelectionV1Input {
  const { domain: _domain, plan: _plan, ...rest } = valid()
  return rest
}

const qualified = {
  domain: { situation: 'have-access', name: 'NovakReality.cz', registrar: 'wedos', emailOnDomain: 'yes' },
  plan: { tier: 'standard', billingPeriod: 'yearly' },
}

describe('storefront selection without domain and plan', () => {
  it('passes intake', () => {
    expect(issues(fromStorefront())).toEqual([])
  })

  it('passes the intake request schema', () => {
    const r = createIntakeRequestSchema(catalog).safeParse({
      contact: { name: 'Jan Novák', email: 'jan@novakreality.cz' },
      consent: { given: true, text: 'Souhlasím se zpracováním osobních údajů za účelem nabídky.' },
      selection: fromStorefront(),
    })
    expect(r.success).toBe(true)
  })

  it('reads back from storage', () => {
    const s = readStoredSelection(fromStorefront())
    expect(s.domain).toBeUndefined()
    expect(s.plan).toBeUndefined()
  })

  it('still validates a domain when one is sent', () => {
    expect(issues({ ...fromStorefront(), domain: { situation: 'have-access', emailOnDomain: 'yes' } })).toEqual([
      'domain.name',
    ])
  })

  it('maps to a site config on the platform subdomain', () => {
    const cfg = toSiteConfigInput(readStoredSelection(fromStorefront()), {
      siteId: 'novak-reality',
      cms: { url: 'https://cms.example.cz', tenantId: 7 },
      platformSubdomain: 'novak-reality.makleri.cz',
      customDomainLive: true,
    })
    expect(cfg.domain).toBe('novak-reality.makleri.cz')
  })
})

describe('provisioning schema', () => {
  const provisioning = createProvisioningSchema(catalog)
  const paths = (input: unknown) => {
    const r = provisioning.safeParse(input)
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
  }

  it('requires domain and plan', () => {
    expect(paths(fromStorefront())).toEqual(['domain', 'plan'])
  })

  it('accepts the selection once qualification is added', () => {
    const json = buildProvisioningJson(fromStorefront(), qualified)
    const r = provisioning.parse(json)
    expect(r.domain.name).toBe('novakreality.cz')
    expect(r.plan.tier).toBe('standard')
  })

  it('applies the intake rules too', () => {
    const ok = buildProvisioningJson(fromStorefront(), qualified)
    expect(paths({ ...ok, theme: { name: 'nope', variant: 'indigo' } })).toEqual(['theme.name'])
    expect(paths({ ...ok, theme: { name: 'realvista', variant: 'purple' } })).toEqual(['theme.variant'])
    expect(paths({ ...ok, sections: { home: ['hero', 'carousel', 'hero'] } })).toEqual([
      'sections.home.1',
      'sections.home.2',
    ])
    expect(paths({ ...ok, status: 'approved' })).toHaveLength(1)
    expect(paths({ ...ok, schemaVersion: 2 })).toEqual(['schemaVersion'])
  })

  it('requires a domain name unless the client has none', () => {
    const json = buildProvisioningJson(fromStorefront(), {
      ...qualified,
      domain: { situation: 'have-no-access', name: null, registrar: null, emailOnDomain: 'unknown' },
    })
    expect(paths(json)).toEqual(['domain.name'])
    expect(
      paths(
        buildProvisioningJson(fromStorefront(), {
          ...qualified,
          domain: { situation: 'none', name: '', registrar: null, emailOnDomain: 'no' },
        }),
      ),
    ).toEqual([])
  })

  it('reports unfilled qualification fields as missing, not invalid', () => {
    const json = buildProvisioningJson(fromStorefront(), {
      domain: { situation: null, name: null, registrar: null, emailOnDomain: null },
      plan: { tier: null, billingPeriod: 'monthly' },
    })
    const r = provisioning.safeParse(json)
    expect(r.success).toBe(false)
    const missing = r.error!.issues.map((i) => i.path.join('.'))
    expect(missing).toEqual(['domain.situation', 'domain.emailOnDomain', 'plan.tier'])
    expect(r.error!.issues.every((i) => i.code === 'invalid_value' || i.code === 'invalid_type')).toBe(true)
  })

  it('lets the lead’s values win over what the selection carried', () => {
    const json = buildProvisioningJson(valid(), {
      ...qualified,
      plan: { tier: 'premium', billingPeriod: 'monthly' },
    })
    expect(json.plan).toEqual({ tier: 'premium', billingPeriod: 'monthly' })
  })

  it('drops keys the stored selection has but v1 does not, instead of failing strict', () => {
    const json = buildProvisioningJson({ ...fromStorefront(), legacyKey: 1 }, qualified)
    expect(json).not.toHaveProperty('legacyKey')
    expect(paths(json)).toEqual([])
  })

  it('refuses a stored selection that is not a v1 selection', () => {
    expect(() => buildProvisioningJson({ schemaVersion: 1 }, qualified)).toThrow()
  })

  it('is bound to the registry for the CRM and /create-website', () => {
    expect(provisioningSchema.safeParse(buildProvisioningJson(fromStorefront(), qualified)).success).toBe(true)
  })
})
