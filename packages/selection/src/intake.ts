import { z } from 'zod'

import type { Catalog } from './catalog.js'
import { createIntakeSchema } from './schema.js'

export const PORTFOLIO_SIZES = ['1-5', '6-20', '20+'] as const

/**
 * The whole storefront submission: who is asking, their consent, and what
 * they picked.
 *
 * Contact details sit beside the selection, not inside it. The selection is
 * the site's configuration; a phone number is not, and putting it in would
 * carry personal data into every copy made at provisioning.
 */
export function createIntakeRequestSchema(catalog: Catalog) {
  return z.strictObject({
    contact: z.strictObject({
      name: z.string().trim().min(2).max(120),
      email: z.email().max(254),
      phone: z.string().trim().max(40).optional(),
    }),
    company: z
      .strictObject({
        ico: z
          .string()
          .trim()
          .regex(/^\d{8}$/, 'IČO má 8 číslic.')
          .optional(),
        name: z.string().trim().max(200).optional(),
      })
      .optional(),
    portfolioSize: z.enum(PORTFOLIO_SIZES).optional(),
    /**
     * The wording exactly as shown, not just a boolean: the wording changes,
     * and consent is only evidence if you can say what was agreed to.
     */
    consent: z.strictObject({
      given: z.literal(true),
      text: z.string().trim().min(20).max(4000),
    }),
    selection: createIntakeSchema(catalog),
    /** Honeypot. Humans never see it; a non-empty value is a bot. */
    website: z.string().max(0).optional(),
  })
}

export type IntakeRequest = z.output<ReturnType<typeof createIntakeRequestSchema>>
