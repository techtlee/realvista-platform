import type { ComponentType } from 'react'

import type { SiteConfig } from '@makleri/core/config'
import type { Post, Property, Service, ServiceIcon, SiteSettings } from '@makleri/core/content'

/**
 * The theme contract.
 *
 * Before this package, a theme was three exported components whose names were
 * spelled out at the client repo's import site and whose props were three
 * bespoke interfaces. TypeScript could tell you an import had failed; it could
 * not tell you a theme was *missing a page*. A client repo discovered that at
 * runtime, on a live domain.
 *
 * Everything here is a type, by design. The contract is checked by the compiler
 * for shape and by `runThemeConformance` for behaviour, and costs nothing at
 * runtime.
 *
 * ## The rule that keeps the CMS fixed
 *
 * Page props are assembled **only** from `@makleri/core/content` types. A theme
 * that wants a field the CMS does not have fails to compile, and the fix is to
 * add that field once, for every theme, in the CMS. That is the whole mechanism
 * behind "a new layout never needs a new content field" — without it, layout #7
 * arrives with its own CMS shape and the fleet stops being one product.
 */

// ── what every page receives ─────────────────────────────────────────────────

/**
 * Handed to every page.
 *
 * `site` is here because the theme used to never see it: `pages.home.sections`
 * was validated by core and then silently ignored, because section order was
 * hard-coded in JSX. A theme is free to ignore the section order, but it can no
 * longer be unable to read it.
 */
export interface ThemePageContext {
  site: SiteConfig
  /** Null when the realtor has not filled in site settings yet — a real state. */
  settings: SiteSettings | null
}

export interface HomePageProps extends ThemePageContext {
  /** Listings the realtor flagged as featured. May be empty. */
  featured: Property[]
  /** A page of recent listings, for the grid and the region chips. */
  listings: Property[]
  /** Total across the whole catalogue, which is larger than `listings`. */
  totalListings: number
  services: Service[]
  posts: Post[]
}

export interface ListingIndexPageProps extends ThemePageContext {
  listings: Property[]
  totalListings: number
}

export interface PropertyDetailPageProps extends ThemePageContext {
  property: Property
  /** Other listings to show underneath. May be empty. */
  similar: Property[]
}

export interface BlogIndexPageProps extends ThemePageContext {
  posts: Post[]
}

export interface PostDetailPageProps extends ThemePageContext {
  post: Post
  /** Other posts, for a "read next" rail. May be empty. */
  recent: Post[]
}

// ── the page surface ─────────────────────────────────────────────────────────

/**
 * Every page a theme must implement.
 *
 * Fixed and non-optional on purpose. An optional page means a client repo
 * routes to it, gets `undefined`, and renders a 500 — or, worse, the route is
 * linked from a header the theme itself ships and 404s. Both have happened
 * here: REALVISTA's header and footer link to `/blog` on every client site, and
 * the route did not exist.
 */
export interface ThemePages {
  Home: ComponentType<HomePageProps>
  ListingIndex: ComponentType<ListingIndexPageProps>
  PropertyDetail: ComponentType<PropertyDetailPageProps>
  BlogIndex: ComponentType<BlogIndexPageProps>
  PostDetail: ComponentType<PostDetailPageProps>
}

export type ThemePageName = keyof ThemePages

/** Iterable form of `keyof ThemePages`, so conformance can loop over pages. */
export const THEME_PAGES: ThemePageName[] = [
  'Home',
  'ListingIndex',
  'PropertyDetail',
  'BlogIndex',
  'PostDetail',
]

// ── the manifest ─────────────────────────────────────────────────────────────

/**
 * A colourway.
 *
 * Lives here rather than in `@makleri/core` because core is a dependency of
 * every site: when core's schema hard-coded REALVISTA's four palette names,
 * a layout with a different palette could not be configured without editing the
 * package all sixty sites depend on.
 */
export interface ThemeVariant {
  /** Matches the `[data-variant='…']` block in the theme's CSS. */
  value: string
  label: { cs: string }
  /** Hex, for a swatch in the storefront picker and the preview switcher. */
  swatch: string
}

/**
 * The typeface, fixed per layout (D9).
 *
 * `subsets` must include `latin-ext`, or Czech diacritics fall back to a system
 * font mid-word — ě š č ř ž ů appear in almost every listing.
 */
export interface ThemeFont {
  /** The `next/font/google` export name, e.g. `DM_Sans`. */
  googleFont: string
  weights: string[]
  subsets: string[]
  /**
   * CSS variable the font is exposed as, e.g. `--font-dm-sans`.
   *
   * Typed as a custom-property name because `next/font` requires one: a plain
   * `string` makes the client repo's font call fail to typecheck.
   */
  cssVariable: `--${string}`
}

export interface ThemeManifest {
  /** Stable slug, matching the CMS `theme.name` option. */
  name: string
  /** Human label for the storefront. */
  label: string
  version: string
  /**
   * Namespace for this theme's CSS custom properties, e.g. `rv`.
   *
   * Unprefixed tokens collide silently when two themes are loaded together,
   * which a gallery does by definition. Conformance enforces it.
   */
  tokenPrefix: string
  font: ThemeFont
  /** At least one. The first is the default. */
  variants: ThemeVariant[]
  /**
   * All eight service icons, or it does not compile.
   *
   * A theme shipping seven renders an empty box — and only for the clients who
   * happen to use that one service, which is the kind of defect that reaches a
   * paying customer before it reaches us.
   */
  icons: Record<ServiceIcon, ComponentType<ServiceIconProps>>
  /**
   * The stylesheet's path inside the package, matching its `exports` entry.
   *
   * A plain string, not a resolved URL. The manifest is imported by the client
   * bundle, and `new URL('…/theme.css', import.meta.url)` here made the bundler
   * treat the stylesheet as a client asset and fail the build. Conformance
   * resolves it against the package root the test file passes in.
   */
  stylesheet: string
  /**
   * Routes this theme links to beyond the five the contract guarantees.
   *
   * Conformance walks every rendered page and fails on an internal link that
   * resolves to neither a contract route nor one listed here. REALVISTA shipped
   * a header and footer linking to four routes that did not exist, which meant
   * a 404 on every client site at once; declaring them turns that from an
   * invisible defect into a list the client template has to satisfy.
   */
  routes?: string[]
  /**
   * Section ids this theme renders, per page, in its default order.
   *
   * The storefront picker offers exactly these, and the intake endpoint
   * rejects anything else — so a picker cannot sell a section the theme does
   * not draw. Only `home` is listed because only `Home` honours
   * `pages.*.sections`; a property-page list here would advertise a control
   * that does nothing.
   */
  sections?: { home: readonly string[] }
}

export interface ServiceIconProps {
  className?: string
}

export interface ThemeModule {
  manifest: ThemeManifest
  pages: ThemePages
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Identity function that pins the type at the definition site.
 *
 * Without it, a theme's mistake surfaces in the *client repo* — far from the
 * code that caused it and usually on someone else's build.
 */
export function defineTheme(theme: ThemeModule): ThemeModule {
  return theme
}

/** True when the theme declares this colourway. */
export function hasVariant(theme: ThemeModule, variant: string): boolean {
  return theme.manifest.variants.some((v) => v.value === variant)
}

/** The default colourway: the first the manifest lists. */
export function defaultVariant(theme: ThemeModule): string {
  const first = theme.manifest.variants[0]
  if (!first) {
    throw new Error(
      `Theme "${theme.manifest.name}" declares no variants. A theme needs at ` +
        `least one colourway; it is what [data-variant] selects.`,
    )
  }
  return first.value
}

/**
 * Checks a client repo's font call against the theme that asked for it.
 *
 * `next/font` only accepts explicitly written literals — the export name, the
 * weights and the subsets cannot come from a variable — so the font block in a
 * client repo's layout is generated per theme and then cannot read the
 * manifest. That leaves the two free to drift, and the failure is close to
 * invisible: the wrong weight renders as a synthesised bold, and a missing
 * `latin-ext` only shows on the Czech characters.
 *
 * So the literals stay, and this says so out loud when they stop matching.
 */
export function assertFontMatches(
  expected: ThemeFont,
  actual: { weights: readonly string[]; subsets: readonly string[]; cssVariable: string },
  themeName = 'the theme',
): void {
  const problems: string[] = []
  const differs = (a: readonly string[], b: readonly string[]) =>
    a.length !== b.length || a.some((v, i) => v !== b[i])

  if (differs(expected.weights, actual.weights)) {
    problems.push(`weights: theme wants [${expected.weights}], layout loads [${actual.weights}]`)
  }
  if (differs(expected.subsets, actual.subsets)) {
    problems.push(`subsets: theme wants [${expected.subsets}], layout loads [${actual.subsets}]`)
  }
  if (expected.cssVariable !== actual.cssVariable) {
    problems.push(
      `cssVariable: theme wants ${expected.cssVariable}, layout exposes ${actual.cssVariable}`,
    )
  }

  if (problems.length > 0) {
    throw new Error(
      `The font loaded in app/layout.tsx does not match ${themeName}'s manifest:\n` +
        problems.map((p) => `  • ${p}`).join('\n') +
        `\n\nnext/font needs literals, so this file is generated from the manifest ` +
        `and cannot read it. Regenerate it rather than editing either half.`,
    )
  }
}
