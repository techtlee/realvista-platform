/**
 * The request schema `cw` validates against.
 *
 * TEMPORARY local mirror of CW-WP1's `packages/selection/src/request.ts`
 * (P3, branch cw/1-platform-prereqs): same names, same rules. When WP1 lands,
 * this file becomes re-exports from `@makleri/selection` and nothing else in
 * the engine changes. The catalog check (unknown theme/colourway, section
 * ids, duplicates, missing domain/plan) already comes from the real package.
 */
import { createProvisioningSchema, type Catalog, type ProvisioningJson } from '@makleri/selection'
import { catalog } from '@makleri/selection/registry'
import { z } from 'zod'

export const SITE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export const RESERVED_SLUGS = ['www', 'admin', 'api', 'crm', 'demo', 'mail'] as const

const slugSchema = z
  .string()
  .regex(SITE_SLUG, 'A slug is lowercase a–z, 0–9 and hyphens, starts and ends with a letter or digit, at most 63 characters.')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), {
    message: `This slug is reserved. Reserved: ${RESERVED_SLUGS.join(', ')}.`,
  })

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
  city: z.string().trim().min(1).max(120).optional(),
})

const crmSchema = z.strictObject({
  leadId: z.number().int().positive(),
  siteId: z.number().int().positive(),
  url: z.url({ protocol: /^https?$/ }).optional(),
})

export function createProvisioningRequestSchema(c: Catalog) {
  return z.strictObject({
    requestVersion: z.literal(1),
    slug: slugSchema,
    crm: crmSchema.optional(),
    contact: contactSchema,
    company: companySchema.optional(),
    provisioning: createProvisioningSchema(c),
  })
}

export const provisioningRequestSchema = createProvisioningRequestSchema(catalog)

export type ProvisioningRequestInput = z.input<typeof provisioningRequestSchema>

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
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Partial<T>
}

export { catalog }
