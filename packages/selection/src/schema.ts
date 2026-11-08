import { z } from 'zod'

import { findTheme, type Catalog } from './catalog.js'

/**
 * The selection JSON, version 1.
 *
 * One object travels picker → lead → deal → tenant → provisioning →
 * `site.config.ts`, and nobody re-keys it at any stage. It is the site config
 * in an earlier and richer form: every key either maps onto `SiteConfigInput`
 * (see mapping.ts) or is deliberately CRM-only.
 *
 * ## Rules
 *
 * 1. `schemaVersion` is never reinterpreted. A v1 payload stays v1 forever;
 *    v2 gets its own schema and an explicit upgrade in upgrade.ts.
 * 2. Additive only. Never remove or repurpose a key — deprecate it here and
 *    leave it in stored documents.
 * 3. The endpoint is the boundary. {@link createIntakeSchema} rejects unknown
 *    themes, colourways and section ids, and duplicated sections, regardless of
 *    what the picker's UI allowed.
 */

export const TONES = ['formal', 'friendly', 'neutral'] as const
export const LOCALES = ['cs-CZ'] as const
export const DOMAIN_SITUATIONS = ['have-access', 'have-no-access', 'none'] as const
export const REGISTRARS = [
  'wedos',
  'forpsi',
  'active24',
  'websupport',
  'gransy',
  'other',
  'unknown',
] as const
export const EMAIL_ON_DOMAIN = ['yes', 'no', 'unknown'] as const
export const PLAN_TIERS = ['basic', 'standard', 'premium'] as const
export const BILLING_PERIODS = ['monthly', 'yearly'] as const

/** A bare hostname: no protocol, no path, at least one dot. */
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const shape = {
  schemaVersion: z.literal(1),
  capturedAt: z.iso.datetime(),

  theme: z.object({
    name: z.string().min(1),
    variant: z.string().min(1),
  }),

  modules: z.object({
    blog: z.boolean(),
    services: z.boolean(),
    listingMap: z.boolean(),
    mortgageCalculator: z.boolean(),
    references: z.boolean(),
  }),

  sections: z.object({
    home: z.array(z.string().min(1)).min(1),
  }),

  brand: z.object({
    name: z.string().trim().min(1).max(120),
    tagline: z.string().trim().max(160).optional(),
    /** Collected after qualification — never uploaded anonymously from the storefront. */
    logo: z.object({ uploadId: z.string().nullable() }).optional(),
  }),

  content: z.object({
    tone: z.enum(TONES),
    locale: z.enum(LOCALES),
  }),

  /**
   * Optional: the storefront does not ask. Settled in the qualification call
   * and stored on the lead; {@link createProvisioningSchema} requires it.
   */
  domain: z
    .object({
      situation: z.enum(DOMAIN_SITUATIONS),
      name: z.string().trim().toLowerCase().regex(HOSTNAME).optional(),
      registrar: z.enum(REGISTRARS).optional(),
      emailOnDomain: z.enum(EMAIL_ON_DOMAIN),
    })
    .optional(),

  /** Optional for the same reason as `domain`. */
  plan: z
    .object({
      tier: z.enum(PLAN_TIERS),
      billingPeriod: z.enum(BILLING_PERIODS),
    })
    .optional(),

  source: z
    .object({
      page: z.string().max(500).optional(),
      previewedVariants: z.array(z.string()).max(50).optional(),
      utm: z
        .object({
          source: z.string().max(200).optional(),
          medium: z.string().max(200).optional(),
          campaign: z.string().max(200).optional(),
          term: z.string().max(200).optional(),
          content: z.string().max(200).optional(),
        })
        .optional(),
    })
    .optional(),
}

/**
 * v1 as stored. Tolerant of keys it does not know, so a key deprecated later
 * still reads back — and does NOT check the catalog, because a lead captured
 * for a since-retired colourway must still render in the CRM two years on.
 */
export const selectionV1Schema = z.object(shape)

export type SelectionV1 = z.output<typeof selectionV1Schema>
export type SelectionV1Input = z.input<typeof selectionV1Schema>

/** The latest version. Moves to v2 when v2 exists; stored v1 is upgraded on read. */
export type Selection = SelectionV1

/**
 * v1 as it arrives from the storefront: strict, and checked against the
 * catalog of themes on sale today. `domain` and `plan` may be absent.
 */
export function createIntakeSchema(catalog: Catalog) {
  return z.strictObject(shape).superRefine(checkAgainstCatalog(catalog))
}

/**
 * v1 as handed to `/create-website`: the intake rules, plus `domain` and
 * `plan` are required. Build the input with {@link buildProvisioningJson}.
 */
export function createProvisioningSchema(catalog: Catalog) {
  return z
    .strictObject({ ...shape, domain: shape.domain.unwrap(), plan: shape.plan.unwrap() })
    .superRefine(checkAgainstCatalog(catalog))
}

export type ProvisioningJson = z.output<ReturnType<typeof createProvisioningSchema>>

/** Staff-entered qualification facts. Nullable because CMS fields come back null when empty. */
export interface QualificationFacts {
  domain: {
    situation: string | null
    name?: string | null
    registrar?: string | null
    emailOnDomain: string | null
  }
  plan: { tier: string | null; billingPeriod: string | null }
}

/**
 * The provisioning JSON: the stored selection with the lead's `domain` and
 * `plan` put in. The lead's values win over anything the selection carried.
 *
 * Does not validate: parse the result with {@link createProvisioningSchema},
 * whose issues say what qualification still has to fill in. The selection is
 * read through {@link selectionV1Schema} first so keys the stored copy has
 * but v1 no longer knows are dropped instead of failing the strict schema.
 * Empty and null fields are left out, so "not filled in yet" reports as
 * missing rather than as an invalid value.
 */
export function buildProvisioningJson(selection: unknown, facts: QualificationFacts): SelectionV1Input {
  const base = selectionV1Schema.parse(selection)
  return {
    ...base,
    domain: compact(facts.domain) as SelectionV1Input['domain'],
    plan: compact(facts.plan) as SelectionV1Input['plan'],
  }
}

function compact<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Partial<T>
}

function checkAgainstCatalog(catalog: Catalog) {
  return (s: z.output<z.ZodObject<typeof shape>>, ctx: z.RefinementCtx) => {
    const theme = findTheme(catalog, s.theme.name)
    if (!theme) {
      ctx.addIssue({
        code: 'custom',
        path: ['theme', 'name'],
        message: `Unknown theme "${s.theme.name}". Available: ${catalog.map((t) => t.name).join(', ')}.`,
      })
      return
    }

    const variants = theme.variants.map((v) => v.value)
    if (!variants.includes(s.theme.variant)) {
      ctx.addIssue({
        code: 'custom',
        path: ['theme', 'variant'],
        message: `"${s.theme.variant}" is not a colourway of ${theme.name}. Available: ${variants.join(', ')}.`,
      })
    }

    const seen = new Set<string>()
    s.sections.home.forEach((id, i) => {
      if (!theme.homeSections.includes(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', 'home', i],
          message: `Unknown home section "${id}" for ${theme.name}. Available: ${theme.homeSections.join(', ')}.`,
        })
      }
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', 'home', i],
          message: `Section "${id}" appears more than once.`,
        })
      }
      seen.add(id)
    })

    s.source?.previewedVariants?.forEach((v, i) => {
      if (!variants.includes(v)) {
        ctx.addIssue({
          code: 'custom',
          path: ['source', 'previewedVariants', i],
          message: `"${v}" is not a colourway of ${theme.name}.`,
        })
      }
    })

    if (s.domain && s.domain.situation !== 'none' && !s.domain.name) {
      ctx.addIssue({
        code: 'custom',
        path: ['domain', 'name'],
        message: 'A domain name is required unless the client has no domain yet.',
      })
    }
  }
}
