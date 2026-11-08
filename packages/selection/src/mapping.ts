import type { SiteConfigInput } from '@makleri/core/config'

import type { Selection } from './schema.js'

/**
 * Facts the selection cannot know, supplied at provisioning time.
 */
export interface ProvisioningFacts {
  /** The tenant slug; becomes `siteId`. */
  siteId: string
  cms: { url: string; tenantId: string | number }
  /** e.g. `novak-reality.makleri.cz`. Used until the client's own domain is live. */
  platformSubdomain: string
  /**
   * Use the client's own domain as the canonical host. False until DNS is
   * pointed — a canonical URL on a domain that does not resolve to the site
   * would put every page's `<link rel=canonical>` somewhere dead.
   */
  customDomainLive?: boolean
}

/**
 * Module toggles that switch a home section off rather than a feature flag.
 *
 * `services` has no `features.*` flag: whether a services section appears is
 * a question of which sections the home page renders. Turning the module off
 * therefore removes its section — the toggle does something, rather than
 * being stored and ignored.
 */
const SECTION_MODULES = { services: 'services', blog: 'blog' } as const

/**
 * Produces the client repo's `site.config.ts` input from a selection.
 *
 * | Selection                                    | SiteConfigInput        |
 * |----------------------------------------------|------------------------|
 * | theme                                        | theme                  |
 * | modules.blog / listingMap / mortgageCalc.    | features.*             |
 * | modules.services / modules.blog = false      | drops that home section|
 * | sections.home                                | pages.home.sections    |
 * | brand.name                                   | brand.name             |
 * | content.locale                               | locale                 |
 * | domain.name (once live)                      | domain                 |
 *
 * Never reaches the site: `content.tone` and `brand.tagline` seed CMS
 * content; `plan` and `source` are CRM-only; `modules.references` has no
 * section in any theme yet and is recorded for the CRM only.
 */
export function toSiteConfigInput(selection: Selection, facts: ProvisioningFacts): SiteConfigInput {
  const off = new Set<string>(
    Object.entries(SECTION_MODULES)
      .filter(([module]) => !selection.modules[module as keyof typeof SECTION_MODULES])
      .map(([, section]) => section),
  )
  const sections = selection.sections.home.filter((id) => !off.has(id))

  const ownDomain =
    facts.customDomainLive && selection.domain.situation !== 'none' && selection.domain.name
      ? selection.domain.name
      : undefined

  return {
    siteId: facts.siteId,
    locale: selection.content.locale,
    domain: ownDomain ?? facts.platformSubdomain,
    theme: { name: selection.theme.name, variant: selection.theme.variant },
    cms: { url: facts.cms.url, tenantId: facts.cms.tenantId },
    brand: { name: selection.brand.name },
    features: {
      blog: selection.modules.blog,
      listingMap: selection.modules.listingMap,
      mortgageCalculator: selection.modules.mortgageCalculator,
    },
    ...(sections.length > 0 ? { pages: { home: { sections } } } : {}),
  }
}
