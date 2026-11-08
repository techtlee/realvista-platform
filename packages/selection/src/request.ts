import { z } from 'zod'

import type { Catalog } from './catalog.js'
import { createProvisioningSchema, type ProvisioningJson } from './schema.js'

/**
 * The provisioning request, version 1: what `/create-website` is handed.
 *
 * An envelope around the provisioning JSON rather than more keys inside it.
 * The JSON is the site's configuration and stays free of personal data (see
 * intake.ts); the slug and the realtor's contact are about the client, not the
 * site, so they sit beside it. The CRM serves this envelope from
 * `GET /api/leads/:id/provisioning-request`, and its download button hands it
 * over as `<slug>.provisioning-request.json`.
 *
 * ## Rules
 *
 * 1. `requestVersion` is never reinterpreted; v2 gets its own schema.
 * 2. `provisioning` is the strict v1 provisioning JSON, unchanged: the same
 *    {@link createProvisioningSchema} the CRM's provisioning-json endpoint
 *    checks, so an envelope can never carry a JSON that endpoint would refuse.
 * 3. Strict at every level. A key this version does not know is an error, not
 *    something to carry silently into a client's repo.
 */

/**
 * A site slug: the tenant slug, the repo suffix (`site-<slug>`) and the
 * fallback subdomain label (`<slug>.realvista.cz`), so a DNS label. The same
 * rule as the CRM's `SITE_SLUG`; the CRM's vendored copy must not drift.
 */
export const SITE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Labels already taken on realvista.cz, or that would read as ours: a client
 * slugged `admin` would get `admin.realvista.cz`.
 */
export const RESERVED_SLUGS = ['www', 'admin', 'api', 'crm', 'demo', 'mail'] as const

const slugSchema = z
  .string()
  .regex(
    SITE_SLUG,
    'A slug is lowercase a–z, 0–9 and hyphens, starts and ends with a letter or digit, at most 63 characters.',
  )
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), {
    message: `This slug is reserved. Reserved: ${RESERVED_SLUGS.join(', ')}.`,
  })

/**
 * The realtor who will log in to the admin. Same limits as the storefront's
 * intake contact, so whatever the CRM stored from intake passes here.
 */
const contactSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  phone: z.string().trim().max(40).optional(),
})

const companySchema = z.strictObject({
  name: z.string().trim().max(200).optional(),
  ico: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'IČO má 8 číslic.')
    .optional(),
  /** From ARES when the IČO is known; starter content uses it for sample listings. */
  city: z.string().trim().min(1).max(120).optional(),
})

/** Where the request came from in the CRM, so provisioning can report back to it. */
const crmSchema = z.strictObject({
  leadId: z.number().int().positive(),
  siteId: z.number().int().positive(),
  url: z.url({ protocol: /^https?$/ }).optional(),
})

export function createProvisioningRequestSchema(catalog: Catalog) {
  return z.strictObject({
    requestVersion: z.literal(1),
    slug: slugSchema,
    crm: crmSchema.optional(),
    contact: contactSchema,
    company: companySchema.optional(),
    provisioning: createProvisioningSchema(catalog),
  })
}

export type ProvisioningRequest = z.output<ReturnType<typeof createProvisioningRequestSchema>>
export type ProvisioningRequestInput = z.input<ReturnType<typeof createProvisioningRequestSchema>>

/**
 * Wraps a bare provisioning JSON (today's CRM download) in a v1 envelope.
 *
 * Does not validate, like {@link buildProvisioningJson}: parse the result,
 * whose issues name what is missing. Empty optional fields are left out so
 * "not given" never reads as an invalid empty string.
 */
export function buildProvisioningRequest(o: {
  slug: string
  contact: { name: string; email: string; phone?: string | null }
  provisioning: ProvisioningJson | unknown
  company?: { name?: string | null; ico?: string | null; city?: string | null } | null
  crm?: { leadId: number; siteId: number; url?: string | null } | null
}): ProvisioningRequestInput {
  const company = o.company ? (compact(o.company) as ProvisioningRequestInput['company']) : undefined
  return {
    requestVersion: 1,
    slug: o.slug,
    ...(o.crm ? { crm: compact(o.crm) as ProvisioningRequestInput['crm'] } : {}),
    contact: compact(o.contact) as ProvisioningRequestInput['contact'],
    ...(company && Object.keys(company).length > 0 ? { company } : {}),
    provisioning: o.provisioning as ProvisioningRequestInput['provisioning'],
  }
}

function compact<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Partial<T>
}
