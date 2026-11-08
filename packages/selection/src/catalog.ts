/**
 * What the storefront can offer, derived from theme manifests.
 *
 * The picker, the intake endpoint and the CRM all read this rather than a
 * hand-kept list, so a colourway the theme does not have cannot be sold, and a
 * new theme needs no storefront deploy — only a new entry in the registry.
 */

/** One colourway, as the picker shows it. */
export interface CatalogVariant {
  value: string
  label: string
  /** Hex brand colour for the swatch. */
  swatch?: string
}

/** One theme, reduced to the data a picker and a validator need. */
export interface CatalogTheme {
  name: string
  label: string
  version: string
  /** The first is the default. */
  variants: CatalogVariant[]
  /** Home section ids in the theme's default order. */
  homeSections: string[]
}

export type Catalog = readonly CatalogTheme[]

/**
 * The structural slice of a `ThemeManifest` this package reads.
 *
 * Structural so the package does not import `@makleri/theme-kit` at runtime —
 * the same reason core declares `ThemeVariantSource`.
 */
export interface ManifestLike {
  name: string
  label: string
  version: string
  variants: { value: string; label?: { cs: string }; swatch?: string }[]
  sections?: { home: readonly string[] }
}

export function catalogEntry(manifest: ManifestLike): CatalogTheme {
  return {
    name: manifest.name,
    label: manifest.label,
    version: manifest.version,
    variants: manifest.variants.map((v) => ({
      value: v.value,
      label: v.label?.cs ?? v.value,
      ...(v.swatch ? { swatch: v.swatch } : {}),
    })),
    homeSections: [...(manifest.sections?.home ?? [])],
  }
}

export function findTheme(catalog: Catalog, name: string): CatalogTheme | undefined {
  return catalog.find((t) => t.name === name)
}
