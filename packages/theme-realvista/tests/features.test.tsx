import type { SiteConfig } from '@makleri/core/config'
import type { Property } from '@makleri/core/content'
import { fixtureListings, themeFixtures } from '@makleri/theme-kit/fixtures'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { mapView, osmEmbedUrl } from '../src/components/PropertyMap.js'
import { monthlyPayment } from '../src/components/MortgageCalculator.js'
import { ContactSection, Header, RealvistaHome, RealvistaPropertyDetail } from '../src/index.js'

/**
 * REALVISTA's modules, as the storefront configurator sells them.
 *
 * The contract-wide rules (blog switch, one header first) live in the kit's
 * conformance suite; these are the parts whose markup is REALVISTA's own.
 */

const [full] = themeFixtures('indigo')
if (!full) throw new Error('no full fixture')

const site = (features: Partial<SiteConfig['features']> = {}, sections?: string[]): SiteConfig => ({
  ...full.site,
  features: { ...full.site.features, ...features },
  pages: sections ? { ...full.site.pages, home: { sections } } : full.site.pages,
})

const detail = (property: Property, features: Partial<SiteConfig['features']> = {}) =>
  renderToStaticMarkup(
    <RealvistaPropertyDetail site={site(features)} settings={full.settings} property={property} similar={[]} />,
  )

// React 19 hoists <link rel="preload"> for images ahead of the page; not content.
const home = (sections: string[]) =>
  stripPreloads(renderToStaticMarkup(
    <RealvistaHome
      site={site({}, sections)}
      settings={full.settings}
      featured={[]}
      listings={full.listings}
      totalListings={full.listings.length}
      services={full.services}
      posts={full.posts}
    />,
  ))

const stripPreloads = (html: string) => html.replace(/^(<link [^>]*>)+/, '')

const iframeSrc = (html: string) => html.match(/<iframe[^>]*\ssrc="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&')

const { apartment, rental, discreet } = fixtureListings

describe('header', () => {
  it('has a phone menu below md that works without JavaScript', () => {
    const html = renderToStaticMarkup(<Header settings={full.settings} site={site({ blog: true })} />)
    const menu = html.match(/<details[^>]*>[\s\S]*<\/details>/)?.[0]
    expect(menu, 'no <details> menu').toBeDefined()
    expect(menu).toMatch(/<details[^>]*class="[^"]*md:hidden/)
    expect(menu).toContain('<summary')
    for (const href of ['/nemovitosti', '/#kontakt', '/blog', '/#o-makleri']) {
      expect(menu).toContain(`href="${href}"`)
    }
  })

  it('drops Blog from the phone menu too when the blog is off', () => {
    const html = renderToStaticMarkup(<Header settings={full.settings} site={site({ blog: false })} />)
    expect(html).not.toContain('href="/blog"')
  })

  it('overlays the hero only when the hero comes first', () => {
    const first = home(['hero', 'featured', 'stats', 'contact'])
    const third = home(['featured', 'stats', 'hero', 'contact'])
    expect(first).toMatch(/^<header class="absolute/)
    expect(third).toMatch(/^<header class="relative/)
    expect(third.match(/<header(?=[\s>])/g)).toHaveLength(1)
  })
})

describe('listing map', () => {
  it('is not rendered when listingMap is off', () => {
    const html = detail(apartment, { listingMap: false })
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('openstreetmap.org')
  })

  it('pins an exact address', () => {
    const src = iframeSrc(detail(apartment, { listingMap: true }))
    expect(src).toMatch(/^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=/)
    expect(src).toContain('&marker=50.10000,14.44000')
  })

  it('shows an approximate area with no pin when hideExactAddress is set', () => {
    const html = detail(discreet, { listingMap: true })
    const src = iframeSrc(html)
    expect(src, 'map missing').toBeDefined()
    expect(src).not.toContain('marker=')
    // The fixture's exact coordinates are 48.74, 14.11 — neither may reach the page.
    expect(html).not.toContain('48.74')
    expect(html).not.toContain('14.11')
    expect(html).not.toContain('mlat=')
    expect(mapView(discreet)).toMatchObject({ pin: false, lat: 48.75, lng: 14.1 })
  })

  it('falls back to the kraj, without a pin, when coordinates are missing', () => {
    const src = iframeSrc(detail(rental, { listingMap: true }))
    expect(src).toBeDefined()
    expect(src).not.toContain('marker=')
  })

  it('renders nothing when there is neither coordinates nor a kraj', () => {
    const nowhere = { ...apartment, address: { city: 'Kladno' } } as Property
    expect(mapView(nowhere)).toBeNull()
    expect(detail(nowhere, { listingMap: true })).not.toContain('<iframe')
  })

  it('never puts more than two decimals of an approximate area in the URL', () => {
    const src = osmEmbedUrl({ lat: 48.7512345, lng: 14.1, span: 0.04, pin: false })
    expect(src).not.toMatch(/\d\.\d{3}/)
  })
})

describe('mortgage calculator', () => {
  it('is not rendered when mortgageCalculator is off', () => {
    expect(detail(apartment, { mortgageCalculator: false })).not.toContain('Hypoteční kalkulačka')
  })

  it('is rendered on a sale when on, with the agreed defaults', () => {
    const html = detail(apartment, { mortgageCalculator: true })
    expect(html).toContain('Hypoteční kalkulačka')
    expect(html).toContain('20 %')
    expect(html).toContain('30 let')
    expect(html).toContain('4,9 %')
    // 8 490 000 Kč, 20 % down → 6 792 000 Kč loan.
    const nbsp = (s: string) => s.replace(/ /g, '[\\s  ]')
    expect(html).toMatch(new RegExp(nbsp('Výše úvěru 6 792 000 Kč')))
    expect(html).toMatch(new RegExp(nbsp(`${monthlyPayment(6792000, 4.9, 30).toLocaleString('cs-CZ').replace(/\s/g, ' ')} Kč`)))
  })

  it('is not rendered on a rental or a price on request, even when on', () => {
    expect(detail(rental, { mortgageCalculator: true })).not.toContain('Hypoteční kalkulačka')
    expect(detail(discreet, { mortgageCalculator: true })).not.toContain('Hypoteční kalkulačka')
  })

  it('computes an annuity', () => {
    // 6 792 000 Kč at 4.9 % over 30 years.
    expect(monthlyPayment(6792000, 4.9, 30)).toBe(36047)
    expect(monthlyPayment(360000, 0, 30)).toBe(1000)
    expect(monthlyPayment(0, 4.9, 30)).toBe(0)
  })
})

describe('contact form', () => {
  const html = renderToStaticMarkup(<ContactSection settings={full.settings} />)

  it('carries a honeypot that people cannot reach', () => {
    const input = html.match(/<input[^>]*name="website"[^>]*>/)?.[0]
    expect(input, 'no honeypot').toBeDefined()
    expect(input).toContain('tabindex="-1"')
    expect(input).toMatch(/autocomplete="off"/i)
    expect(html).toMatch(/<div aria-hidden="true" class="absolute -left-\[9999px\][^"]*"><label>Web<input[^>]*name="website"/)
  })

  it('offers an optional phone field', () => {
    const input = html.match(/<input[^>]*name="phone"[^>]*>/)?.[0]
    expect(input).toContain('type="tel"')
    expect(input).not.toContain('required')
  })
})

describe('hero portrait', () => {
  const withPortrait = (portrait: unknown) =>
    stripPreloads(renderToStaticMarkup(
      <RealvistaHome
        site={site({}, ['hero', 'featured'])}
        settings={{ ...full.settings, hero: { ...full.settings.hero, portrait } } as typeof full.settings}
        featured={[]}
        listings={full.listings}
        totalListings={full.listings.length}
        services={full.services}
        posts={full.posts}
      />,
    ))

  it('layers a cut-out portrait over the background when one is set', () => {
    const html = withPortrait({ id: 99, url: '/media/portret.png', alt: 'Portrét', width: 575, height: 700 })
    expect(html).toContain('rv-hero--portrait')
    expect(html).toMatch(/<img[^>]*src="\/media\/portret.png"[^>]*class="rv-hero-portrait/)
  })

  it('renders no portrait layer without one', () => {
    const html = withPortrait(null)
    expect(html).not.toContain('rv-hero-portrait')
    expect(html).not.toContain('rv-hero--portrait')
  })
})
