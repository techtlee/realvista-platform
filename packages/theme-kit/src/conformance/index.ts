import { readFileSync } from 'node:fs'

import type { SiteConfig } from '@makleri/core/config'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  BlogIndexPageProps,
  HomePageProps,
  ListingIndexPageProps,
  PostDetailPageProps,
  PropertyDetailPageProps,
  ThemeModule,
  ThemePageName,
} from '../index.js'
import { THEME_PAGES } from '../index.js'
import type { ThemeFixture } from '../fixtures/index.js'
import { CZECH_DIACRITICS, SERVICE_ICONS, themeFixtures } from '../fixtures/index.js'
import {
  cssVariants,
  danglingLinks,
  headerComesFirst,
  linksToBlog,
  strayTokens,
  tagCount,
  usesThemeInline,
} from './checks.js'

/**
 * The conformance suite — the deliverable that keeps the CMS fixed.
 *
 * A theme's whole test file is one line:
 *
 *     runThemeConformance(theme)
 *
 * Types catch a theme with the wrong *shape*. This catches a theme that is the
 * right shape and still wrong: one that crashes when the realtor has not filled
 * anything in, that ships seven of the eight service icons, that defines CSS
 * tokens outside its namespace so it cannot share a page with another theme, or
 * that links to a route no client repo provides — which is how REALVISTA
 * shipped a header linking to a 404 on every site at once.
 *
 * ## What it deliberately does not check
 *
 * Layout. There is no viewport here: `renderToStaticMarkup` produces a string,
 * so "no horizontal overflow at 375px" cannot be asserted — it needs a real
 * browser and belongs in a Playwright gate. Claiming it here would be worse
 * than not checking it, because it would read as covered.
 */

function buildProps(theme: ThemeModule, f: ThemeFixture) {
  const base = { site: f.site, settings: f.settings }
  const property = f.listings[0]
  const post = f.posts[0]

  const props: Partial<Record<ThemePageName, unknown>> = {
    Home: {
      ...base,
      featured: f.listings.filter((p) => p.featured),
      listings: f.listings,
      totalListings: f.listings.length,
      services: f.services,
      posts: f.posts,
    } satisfies HomePageProps,
    ListingIndex: {
      ...base,
      listings: f.listings,
      totalListings: f.listings.length,
    } satisfies ListingIndexPageProps,
    BlogIndex: { ...base, posts: f.posts } satisfies BlogIndexPageProps,
  }

  // PropertyDetail and PostDetail need a subject. The `empty` fixture has
  // neither by design, so those pages are simply not exercised there — a
  // visitor cannot reach a detail page that has no document behind it.
  if (property) {
    props.PropertyDetail = {
      ...base,
      property,
      similar: f.listings.slice(1, 4),
    } satisfies PropertyDetailPageProps
  }
  if (post) {
    props.PostDetail = {
      ...base,
      post,
      recent: f.posts.slice(1, 4),
    } satisfies PostDetailPageProps
  }

  return props
}

/** Normalises a package root to a directory URL, so `new URL` resolves inside it. */
function toDirUrl(root: string | URL): URL {
  const url = typeof root === 'string' ? new URL(root, 'file://') : new URL(root.href)
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

/** The home order a fixture asks for, falling back to the theme's own default. */
const homeSections = (site: SiteConfig): string[] => [...(site.pages.home?.sections ?? [])]

const render = (theme: ThemeModule, page: ThemePageName, props: unknown): string =>
  renderToStaticMarkup(createElement(theme.pages[page] as never, props as never))

export interface ConformanceOptions {
  /**
   * The theme package's root, so the stylesheet can be read from disk.
   *
   * A test file passes `new URL('..', import.meta.url)`. It is not on the
   * manifest because the manifest ships to the browser, where a resolved file
   * URL to a .css is both useless and a build error.
   */
  packageRoot?: string | URL
  /**
   * Skip the stylesheet checks.
   *
   * For a theme under construction whose CSS is not written yet — never for one
   * that is offered to a client.
   */
  skipStyles?: boolean
}

export function runThemeConformance(theme: ThemeModule, options: ConformanceOptions = {}) {
  const { manifest } = theme
  const name = manifest.name || '(unnamed theme)'

  describe(`theme conformance: ${name}`, () => {
    // ── manifest ─────────────────────────────────────────────────────────────

    describe('manifest', () => {
      it('identifies itself', () => {
        expect(manifest.name).toMatch(/^[a-z][a-z0-9-]*$/)
        expect(manifest.label.length).toBeGreaterThan(0)
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
      })

      it('namespaces its CSS tokens', () => {
        expect(manifest.tokenPrefix).toMatch(/^[a-z][a-z0-9]*$/)
      })

      it('declares at least one colourway, with unique values and hex swatches', () => {
        expect(manifest.variants.length).toBeGreaterThan(0)
        const values = manifest.variants.map((v) => v.value)
        expect(new Set(values).size).toBe(values.length)
        for (const v of manifest.variants) {
          expect(v.value, 'variant value').toMatch(/^[a-z][a-z0-9-]*$/)
          expect(v.label.cs.length, `Czech label for "${v.value}"`).toBeGreaterThan(0)
          expect(v.swatch, `swatch for "${v.value}"`).toMatch(/^#[0-9a-f]{3,8}$/i)
        }
      })

      it('loads a font that can render Czech', () => {
        // Without latin-ext, ě š č ř ž ů fall back to a system face mid-word.
        expect(manifest.font.subsets).toContain('latin-ext')
        expect(manifest.font.weights.length).toBeGreaterThan(0)
        expect(manifest.font.cssVariable).toMatch(/^--/)
      })

      it('ships all eight service icons', () => {
        for (const icon of SERVICE_ICONS) {
          expect(manifest.icons[icon], `icon "${icon}"`).toBeTypeOf('function')
        }
      })

      it('renders every service icon to visible markup', () => {
        for (const icon of SERVICE_ICONS) {
          const Icon = manifest.icons[icon]
          if (!Icon) continue // reported by the check above
          const html = renderToStaticMarkup(createElement(Icon))
          expect(html.length, `icon "${icon}" rendered empty`).toBeGreaterThan(0)
        }
      })
    })

    // ── page surface ─────────────────────────────────────────────────────────

    describe('pages', () => {
      it('implements every page in the contract', () => {
        for (const page of THEME_PAGES) {
          expect(theme.pages[page], `page "${page}"`).toBeTypeOf('function')
        }
      })
    })

    // ── rendering ────────────────────────────────────────────────────────────

    for (const variant of manifest.variants) {
      describe(`renders · ${variant.value}`, () => {
        for (const fixture of themeFixtures(variant.value)) {
          const props = buildProps(theme, fixture)

          for (const page of THEME_PAGES) {
            const p = props[page]
            if (!p) continue

            it(`${page} · ${fixture.name}`, () => {
              const html = render(theme, page, p)
              expect(html.length, 'rendered nothing').toBeGreaterThan(0)
            })
          }

          if (fixture.name === 'full') {
            it(`keeps Czech diacritics · ${fixture.name}`, () => {
              const html = render(theme, 'Home', props.Home)
              expect(html).toContain('Holešovice')
              expect(html).toContain('Nováková')
            })
          }

          it(`links only to routes a client repo provides · ${fixture.name}`, () => {
            const offenders = new Set<string>()

            for (const page of THEME_PAGES) {
              const p = props[page]
              if (!p) continue
              for (const link of danglingLinks(render(theme, page, p), manifest.routes ?? [])) {
                offenders.add(`${page} → ${link}`)
              }
            }

            expect(
              [...offenders],
              'These links 404 on a live client site. Either the theme should not ' +
                'render them, or the route belongs in manifest.routes and the ' +
                'client template must provide it.',
            ).toEqual([])
          })
        }
      })
    }

    it('survives the day-one site: nothing filled in, nothing crashes', () => {
      const [, minimal] = themeFixtures(manifest.variants[0]?.value ?? 'default')
      expect(minimal).toBeDefined()
      const props = buildProps(theme, minimal as ThemeFixture)
      for (const page of THEME_PAGES) {
        const p = props[page]
        if (!p) continue
        expect(() => render(theme, page, p), `page "${page}" crashed`).not.toThrow()
      }
    })

    // ── modules and layout ──────────────────────────────────────────────────
    //
    // The storefront configurator sells these switches and the section order;
    // a theme that ignores them ships a site that is not what the realtor bought.
    // Behaviour, not colour, so the first colourway is enough.

    describe('modules and layout', () => {
      const [full] = themeFixtures(manifest.variants[0]?.value ?? 'default')
      const fixture = full as ThemeFixture
      const withSite = (patch: (site: SiteConfig) => SiteConfig) =>
        buildProps(theme, { ...fixture, site: patch(fixture.site) })
      const blog = (on: boolean) =>
        withSite((site) => ({
          ...site,
          features: { ...site.features, blog: on },
          pages: { ...site.pages, home: { sections: [...homeSections(site), 'blog'] } },
        }))

      it('links no blog route when the blog is off', () => {
        // The client repo 404s /blog when features.blog is off. The blog pages
        // themselves are unreachable then, so only the others are checked.
        const props = blog(false)
        for (const page of ['Home', 'ListingIndex', 'PropertyDetail'] as const) {
          const html = render(theme, page, props[page])
          expect(linksToBlog(html), `${page} links to the blog with features.blog off`).toBe(false)
        }
      })

      it('links the blog when it is on', () => {
        expect(linksToBlog(render(theme, 'Home', blog(true).Home))).toBe(true)
      })

      it('renders exactly one header, first, on every page', () => {
        const props = buildProps(theme, fixture)
        for (const page of THEME_PAGES) {
          const html = render(theme, page, props[page])
          expect(tagCount(html, 'header'), `${page}: <header> count`).toBe(1)
          expect(headerComesFirst(html), `${page}: header is not first`).toBe(true)
        }
      })

      it('keeps one header first when the hero is not the first section', () => {
        const props = withSite((site) => {
          const rest = homeSections(site).filter((s) => s !== 'hero')
          return { ...site, pages: { ...site.pages, home: { sections: [...rest.slice(0, 2), 'hero', ...rest.slice(2)] } } }
        })
        const html = render(theme, 'Home', props.Home)
        expect(tagCount(html, 'header'), '<header> count').toBe(1)
        expect(headerComesFirst(html), 'header is not first').toBe(true)
      })
    })

    // ── stylesheet ───────────────────────────────────────────────────────────

    const describeStyles = options.skipStyles ? describe.skip : describe

    describeStyles('stylesheet', () => {
      if (!options.packageRoot) {
        throw new Error(
          `runThemeConformance(${name}) needs { packageRoot } to find ` +
            `"${manifest.stylesheet}". Pass new URL('..', import.meta.url) from ` +
            `the theme's test file, or skipStyles for a theme still being built.`,
        )
      }

      const css = readFileSync(new URL(manifest.stylesheet, toDirUrl(options.packageRoot)), 'utf8')
      const prefix = `--${manifest.tokenPrefix}-`

      it('uses @theme inline', () => {
        // Without `inline`, Tailwind bakes token values in at build time and
        // every [data-variant] block silently does nothing.
        expect(usesThemeInline(css)).toBe(true)
      })

      it('defines every custom property under its own prefix', () => {
        expect(
          strayTokens(css, manifest.tokenPrefix),
          `Tokens outside the "${prefix}" namespace collide when two themes are ` +
            `loaded together, which a gallery does by definition.`,
        ).toEqual([])
      })

      it('implements every colourway it declares', () => {
        for (const [i, v] of manifest.variants.entries()) {
          const block = new RegExp(`\\[data-variant=['"]${v.value}['"]\\]`)
          // The first variant may be the :root default rather than a block.
          const ok = block.test(css) || (i === 0 && /:root[\s,]/.test(css))
          expect(ok, `no CSS block for variant "${v.value}"`).toBe(true)
        }
      })

      it('declares no colourway it does not advertise', () => {
        const declared = new Set(manifest.variants.map((v) => v.value))
        const undeclared = cssVariants(css).filter((v) => !declared.has(v))

        expect(
          undeclared,
          'A colourway in the CSS but not in the manifest cannot be selected ' +
            'from site.config.ts or offered in the storefront.',
        ).toEqual([])
      })
    })
  })
}

export { CZECH_DIACRITICS, themeFixtures }
export * from './checks.js'
