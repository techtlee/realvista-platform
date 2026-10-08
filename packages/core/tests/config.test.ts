import { describe, expect, it } from 'vitest'

import { defineSiteConfig } from '../src/config'

const minimal = {
  siteId: 'novak-reality',
  theme: { name: 'realvista', variant: 'clay' as const },
  domain: 'novakreality.cz',
  cms: { url: 'https://cms.makleri.cz', tenantId: 7 },
}

/**
 * Stands in for a theme module. Structural, exactly as a real one is: core
 * validates against whatever the client repo hands it and knows no theme.
 */
const theme = {
  manifest: {
    name: 'realvista',
    variants: [{ value: 'indigo' }, { value: 'crimson' }, { value: 'clay' }, { value: 'mono' }],
  },
}

describe('defineSiteConfig', () => {
  it('accepts a minimal config and applies defaults', () => {
    const cfg = defineSiteConfig(minimal)

    expect(cfg.locale).toBe('cs-CZ')
    expect(cfg.features.blog).toBe(false)
    expect(cfg.features.listingMap).toBe(true)
    expect(cfg.features.mortgageCalculator).toBe(false)
  })

  it('derives siteUrl from the domain', () => {
    expect(defineSiteConfig(minimal).siteUrl).toBe('https://novakreality.cz')
  })

  it('normalises a domain given with protocol or trailing slash', () => {
    expect(defineSiteConfig({ ...minimal, domain: 'https://novakreality.cz/' }).siteUrl).toBe(
      'https://novakreality.cz',
    )
  })

  it('preserves explicit feature flags', () => {
    const cfg = defineSiteConfig({ ...minimal, features: { blog: true } })

    expect(cfg.features.blog).toBe(true)
    // Unspecified flags must still fall back, not become undefined.
    expect(cfg.features.listingMap).toBe(true)
  })

  it('allows custom section ids so Tier 3 overrides are not forced into a fork', () => {
    const cfg = defineSiteConfig({
      ...minimal,
      pages: { home: { sections: ['hero', 'novak-mortgage', 'contact'] } },
    })

    expect(cfg.pages.home?.sections).toContain('novak-mortgage')
  })

  describe('failing the build rather than shipping a broken site', () => {
    it('rejects a missing siteId', () => {
      expect(() => defineSiteConfig({ ...minimal, siteId: '' })).toThrow(/siteId/)
    })

    it('rejects an empty theme variant', () => {
      expect(() =>
        defineSiteConfig({ ...minimal, theme: { name: 'realvista', variant: '' } }),
      ).toThrow(/theme\.variant/)
    })

    it('rejects a non-URL cms.url', () => {
      expect(() =>
        defineSiteConfig({ ...minimal, cms: { url: 'cms.makleri.cz', tenantId: 7 } }),
      ).toThrow(/cms\.url/)
    })

    it('names the site in the error so a failing fleet build is traceable', () => {
      expect(() => defineSiteConfig({ ...minimal, domain: '' })).toThrow(/novak-reality/)
    })

    describe('when the theme is passed in', () => {
      it('accepts a colourway the theme implements', () => {
        expect(defineSiteConfig(minimal, theme).theme.variant).toBe('clay')
      })

      it('rejects one it does not, and lists the real ones', () => {
        expect(() =>
          defineSiteConfig({ ...minimal, theme: { name: 'realvista', variant: 'purple' } }, theme),
        ).toThrow(/indigo, crimson, clay, mono/)
      })

      it('rejects a config naming a different theme than the one imported', () => {
        expect(() =>
          defineSiteConfig({ ...minimal, theme: { name: 'other-layout', variant: 'clay' } }, theme),
        ).toThrow(/other-layout/)
      })

      it('accepts a colourway core has never heard of', () => {
        // The whole point: layout #2 may have a palette with none of these names.
        const layout2 = { manifest: { name: 'nordic', variants: [{ value: 'slate' }] } }
        const cfg = defineSiteConfig(
          { ...minimal, theme: { name: 'nordic', variant: 'slate' } },
          layout2,
        )
        expect(cfg.theme.variant).toBe('slate')
      })
    })

    it('rejects an empty section list', () => {
      expect(() =>
        defineSiteConfig({ ...minimal, pages: { home: { sections: [] } } }),
      ).toThrow(/pages\.home\.sections/)
    })
  })
})
