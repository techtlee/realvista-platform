import type { ProvisioningRequest } from '../../src/types.js'

/**
 * Client #1 (novak-test) as a provisioning request: the facts the runbook's
 * Phase E was written for (domain novak-test.cz at Wedos, e-mail on the
 * domain). Fictional data.
 */
export function novakRequest(): ProvisioningRequest {
  return {
    requestVersion: 1,
    slug: 'novak-test',
    crm: { leadId: 1, siteId: 1, url: 'http://localhost:3029' },
    contact: { name: 'Jan Novák', email: 'jan.novak@novak-test.cz' },
    company: { city: 'Plzeň' },
    provisioning: {
      schemaVersion: 1,
      capturedAt: '2026-11-08T09:00:00.000Z',
      theme: { name: 'realvista', variant: 'clay' },
      modules: { blog: true, services: true, listingMap: true, mortgageCalculator: true, references: false },
      sections: { home: ['hero', 'agent', 'featured', 'stats', 'services', 'blog', 'contact'] },
      brand: { name: 'Jan Novák Reality' },
      content: { tone: 'formal', locale: 'cs-CZ' },
      domain: { situation: 'have-access', name: 'novak-test.cz', registrar: 'wedos', emailOnDomain: 'yes' },
      plan: { tier: 'standard', billingPeriod: 'yearly' },
    },
  }
}

/** A client with no domain yet (situation none): fallback addresses only. */
export function noDomainRequest(): ProvisioningRequest {
  const r = novakRequest()
  return {
    ...r,
    slug: 'svoboda-reality',
    contact: { name: 'Petra Svobodová', email: 'petra@svoboda-reality.cz' },
    provisioning: { ...r.provisioning, domain: { situation: 'none', emailOnDomain: 'unknown' } },
  }
}
