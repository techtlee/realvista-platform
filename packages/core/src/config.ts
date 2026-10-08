import { z } from 'zod'

/**
 * The client repo's `site.config.ts`.
 *
 * This is the whole surface a stock site exposes: about thirty lines of
 * configuration and no components. Everything else — routing, content access,
 * SEO, the theme itself — arrives as a versioned package, which is what makes
 * a fleet-wide fix a lockfile bump instead of sixty hand edits.
 *
 * Validated at build time rather than trusted, because the alternative is a
 * typo rendering a broken page on a paying client's domain. A bad config fails
 * the Vercel build loudly instead.
 */

/**
 * A colourway is any string here, and is checked against the theme instead.
 *
 * This used to be `z.enum(['indigo', 'crimson', 'clay', 'mono'])` — REALVISTA's
 * four palette names, baked into the package every client site depends on. A
 * second layout with a different palette could not be configured without
 * editing core and shipping it to all sixty sites. Which colourways exist is a
 * fact about a theme, so the theme is what validates it.
 */
const themeVariantSchema = z.string().min(1)

const siteConfigSchema = z.object({
  /** Stable identifier, matching the tenant slug in the CMS. */
  siteId: z.string().min(1),

  locale: z.string().default('cs-CZ'),

  theme: z.object({
    name: z.string().min(1),
    variant: themeVariantSchema,
  }),

  /** Canonical production host, no protocol (e.g. `novakreality.cz`). */
  domain: z.string().min(1),

  cms: z.object({
    /** Payload origin. */
    url: z.string().url(),
    /** Tenant id this site is allowed to read. */
    tenantId: z.union([z.string(), z.number()]),
  }),

  brand: z
    .object({
      name: z.string().optional(),
    })
    .prefault({}),

  /**
   * Feature flags. Anything here should be answerable by config alone —
   * the moment a flag needs a bespoke component, it belongs in the override
   * map instead.
   */
  features: z
    .object({
      blog: z.boolean().default(false),
      listingMap: z.boolean().default(true),
      mortgageCalculator: z.boolean().default(false),
    })
    .prefault({}),

  /**
   * Section order per page type.
   *
   * Typed loosely on purpose: stock section ids come from the theme, but a
   * Tier 3 custom section is registered by the client repo under an arbitrary
   * id, and rejecting those here would push customisation back into forking.
   */
  pages: z
    .object({
      home: z.object({ sections: z.array(z.string()).min(1) }).optional(),
      property: z.object({ sections: z.array(z.string()).min(1) }).optional(),
    })
    .prefault({}),

  seo: z
    .object({
      titleSuffix: z.string().optional(),
      defaultDescription: z.string().optional(),
    })
    .prefault({}),
})

export type SiteConfigInput = z.input<typeof siteConfigSchema>
export type SiteConfig = z.output<typeof siteConfigSchema> & {
  /** Derived, so themes never have to reassemble it. */
  siteUrl: string
}

/**
 * The shape `defineSiteConfig` needs in order to check a colourway.
 *
 * Structural on purpose: a real `ThemeModule` from `@makleri/theme-kit`
 * satisfies it without core importing that package, so core keeps its one
 * genuinely valuable property — it depends on no theme, and no theme kit.
 */
export interface ThemeVariantSource {
  manifest: {
    name: string
    variants: { value: string; label?: { cs: string } }[]
  }
}

/**
 * Validates and normalises a client site's configuration.
 *
 * @throws if the config is invalid — deliberately, at build time.
 */
export function defineSiteConfig(
  input: SiteConfigInput,
  theme?: ThemeVariantSource,
): SiteConfig {
  const parsed = siteConfigSchema.safeParse(input)

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')

    throw new Error(
      `Invalid site.config.ts for "${input?.siteId ?? 'unknown site'}":\n${problems}\n\n` +
        `Fix the configuration — the build is failing on purpose rather than ` +
        `deploying a broken site to a live domain.`,
    )
  }

  const data = parsed.data

  // Checked against the theme rather than a list in this package, so a layout
  // can ship three colourways or nine without core knowing any of their names.
  if (theme) {
    const known = theme.manifest.variants.map((v) => v.value)

    if (data.theme.name !== theme.manifest.name) {
      throw new Error(
        `site.config.ts for "${data.siteId}" names theme "${data.theme.name}", ` +
          `but the theme passed in is "${theme.manifest.name}". The build is ` +
          `failing rather than rendering one theme's pages with another's config.`,
      )
    }

    if (!known.includes(data.theme.variant)) {
      throw new Error(
        `Invalid site.config.ts for "${data.siteId}":\n` +
          `  • theme.variant: "${data.theme.variant}" is not a colourway of ` +
          `"${theme.manifest.name}". Available: ${known.join(', ')}.\n\n` +
          `An unknown variant renders the theme's default palette with no error, ` +
          `so a typo would ship the wrong brand colour to a paying client.`,
      )
    }
  }

  return {
    ...data,
    siteUrl: `https://${data.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`,
  }
}
