import { describe, expect, it } from 'vitest'

import {
  CONTRACT_ROUTES,
  cssVariants,
  danglingLinks,
  headerComesFirst,
  internalLinks,
  linksToBlog,
  strayTokens,
  tagCount,
  usesThemeInline,
} from '../src/conformance/checks.js'
import { themeFixtures } from '../src/fixtures/index.js'

/**
 * Tests for the gate itself.
 *
 * A conformance check that cannot fail looks identical to one that passes, and
 * the entire argument for the theme contract rests on these firing. Each case
 * below is a defect that actually shipped, or one layout #2 is likely to hit.
 */

describe('danglingLinks', () => {
  it('passes the routes a client repo provides', () => {
    const html = `
      <a href="/">Domů</a>
      <a href="/nemovitosti">Nemovitosti</a>
      <a href="/nemovitosti/prodej-bytu-3-kk-praha">Detail</a>
      <a href="/blog">Blog</a>
      <a href="/blog/jak-pripravit-byt-na-prodej">Článek</a>
    `
    expect(danglingLinks(html)).toEqual([])
  })

  it('catches the links REALVISTA actually shipped to a 404', () => {
    // These were live in the header and footer of every client site.
    const html = `
      <a href="/blog">Blog</a>
      <a href="/zasady-ochrany-osobnich-udaju">GDPR</a>
      <a href="/cookies">Cookies</a>
    `
    expect(danglingLinks(html)).toEqual(['/zasady-ochrany-osobnich-udaju', '/cookies'])
  })

  it('accepts a route the theme declares in its manifest', () => {
    const html = '<a href="/sluzby">Služby</a>'
    expect(danglingLinks(html)).toEqual(['/sluzby'])
    expect(danglingLinks(html, ['/sluzby'])).toEqual([])
  })

  it('ignores query strings and fragments, which do not change the route', () => {
    const html = `
      <a href="/nemovitosti?kraj=praha">Praha</a>
      <a href="/nemovitosti#nabidka">Nabídka</a>
    `
    expect(danglingLinks(html)).toEqual([])
  })

  it('leaves external, mail and phone links alone', () => {
    const html = `
      <a href="https://instagram.com/x">IG</a>
      <a href="mailto:a@b.cz">Mail</a>
      <a href="tel:+420777123456">Tel</a>
      <a href="#kontakt">Kontakt</a>
    `
    expect(internalLinks(html)).toEqual([])
    expect(danglingLinks(html)).toEqual([])
  })

  it('ignores the preload links React emits for images', () => {
    // React 19 injects <link rel="preload" as="image" href="…"> during render.
    // Counting those reported every photo in the fixtures as a broken route.
    const html = `
      <link rel="preload" as="image" href="/media/file/fixture-1-hero.webp"/>
      <a href="/nemovitosti">Nemovitosti</a>
    `
    expect(internalLinks(html)).toEqual(['/nemovitosti'])
    expect(danglingLinks(html)).toEqual([])
  })

  it('does not let a slug swallow a nested path', () => {
    // '/nemovitosti/:slug' must not match two segments, or a broken nested
    // route would pass as a listing detail page.
    expect(danglingLinks('<a href="/nemovitosti/praha/byty">x</a>')).toEqual([
      '/nemovitosti/praha/byty',
    ])
  })

  it('covers exactly the five routes the contract guarantees', () => {
    expect(CONTRACT_ROUTES).toHaveLength(5)
  })
})

describe('strayTokens', () => {
  const css = `
@theme inline {
  --color-brand: var(--rv-brand);
  --radius-btn: var(--rv-radius-btn);
}

:root {
  --rv-brand: #0d0053;
  --rv-page: #f9f9ff;
}
`

  it('exempts the Tailwind mapping layer inside @theme', () => {
    expect(strayTokens(css, 'rv')).toEqual([])
  })

  it('catches a token declared outside the theme namespace', () => {
    const leaky = `${css}\n[data-variant='mono'] {\n  --brand-dark: #111;\n}\n`
    expect(strayTokens(leaky, 'rv')).toEqual(['--brand-dark'])
  })

  it('catches a second theme using the first theme prefix', () => {
    // The gallery case: two themes loaded together, one silently overwriting
    // the other's palette.
    expect(strayTokens(css, 'nd')).toEqual(['--rv-brand', '--rv-page'])
  })
})

describe('usesThemeInline', () => {
  it('requires the inline keyword, not merely @theme', () => {
    expect(usesThemeInline('@theme inline {\n  --color-brand: var(--rv-brand);\n}')).toBe(true)
    // Without `inline`, Tailwind bakes values in at build time and every
    // [data-variant] block silently does nothing — the failure is invisible.
    expect(usesThemeInline('@theme {\n  --color-brand: var(--rv-brand);\n}')).toBe(false)
  })
})

describe('cssVariants', () => {
  it('finds every colourway block, single or double quoted, once each', () => {
    const css = `
      [data-variant='indigo'] { --rv-brand: #0d0053; }
      [data-variant="crimson"] { --rv-brand: #ad0c14; }
      [data-variant='indigo'] .x { color: red; }
    `
    expect(cssVariants(css).sort()).toEqual(['crimson', 'indigo'])
  })
})

describe('fixtures', () => {
  const [full, minimal, empty] = themeFixtures('indigo')

  it('covers the three states a client site is actually in', () => {
    expect([full?.name, minimal?.name, empty?.name]).toEqual(['full', 'minimal', 'empty'])
  })

  it('gives the minimal fixture no settings at all — the day-one null guard', () => {
    expect(minimal?.settings).toBeNull()
    expect(minimal?.listings).toHaveLength(1)
  })

  it('gives the empty fixture settings but nothing to list', () => {
    expect(empty?.settings).not.toBeNull()
    expect(empty?.listings).toEqual([])
    expect(empty?.posts).toEqual([])
    expect(empty?.services).toEqual([])
  })

  it('includes the listings that break a theme written for apartments', () => {
    const byId = Object.fromEntries((full?.listings ?? []).map((p) => [p.slug, p]))
    const plot = byId['prodej-pozemku-ricany']
    expect(plot?.disposition).toBeUndefined()
    expect(plot?.usableArea).toBeUndefined()
    expect(plot?.penb?.class).toBe('EXEMPT')

    const discreet = byId['prodej-vily-cerna-v-posumavi']
    expect(discreet?.address.hideExactAddress).toBe(true)
    expect(discreet?.price?.onRequest).toBe(true)

    const bare = byId['nabidka-bez-fotografii']
    expect(bare?.gallery).toBeUndefined()
    expect(bare?.price).toBeUndefined()
  })

  it('ships one service per icon, so a missing icon shows up by rendering', () => {
    expect(full?.services).toHaveLength(8)
    expect(new Set((full?.services ?? []).map((s) => s.icon)).size).toBe(8)
  })

  it('carries the variant through to every fixture site config', () => {
    for (const f of themeFixtures('crimson')) {
      expect(f.site.theme.variant).toBe('crimson')
    }
  })
})

describe('tagCount', () => {
  it('counts element openings, not lookalikes', () => {
    const html = '<header class="a"></header><headline></headline><header-bar></header-bar><header>x</header>'
    expect(tagCount(html, 'header')).toBe(2)
  })
})

describe('headerComesFirst', () => {
  it('passes a header ahead of the sections', () => {
    expect(headerComesFirst('<header>nav</header><section>hero</section>')).toBe(true)
  })

  it('catches a header carried inside the hero', () => {
    // REALVISTA before the fix: move the hero down and the nav goes with it.
    expect(headerComesFirst('<section>featured</section><section><header>nav</header></section>')).toBe(false)
  })

  it('fails a page with no header at all', () => {
    expect(headerComesFirst('<section>hero</section>')).toBe(false)
  })
})

describe('linksToBlog', () => {
  it('sees the index and posts, ignoring look-alike routes', () => {
    expect(linksToBlog('<a href="/blog">Blog</a>')).toBe(true)
    expect(linksToBlog('<a href="/blog/penb">Článek</a>')).toBe(true)
    expect(linksToBlog('<a href="/blogger">x</a><a href="https://example.cz/blog">x</a>')).toBe(false)
  })
})
