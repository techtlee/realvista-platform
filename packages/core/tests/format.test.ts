import { describe, expect, it } from 'vitest'

import type { Property } from '../src/content/types'
import {
  CZ_REGIONS,
  cardTitle,
  dispositionLabel,
  energyLabel,
  formatDate,
  formatPrice,
  imageUrl,
  locationLabel,
  pricePerSquareMetre,
  propertyHeading,
  regionCounts,
  regionLabel,
  richTextToParagraphs,
  statusBadge,
} from '../src/format'

/**
 * The Czech presentation layer is the one piece of logic every theme shares, so
 * a change here is a change to every client site at once. These pin the
 * behaviour that is a judgement call rather than a formatting detail — the
 * privacy flag, the rental guards, and the fall-through that makes a missing
 * label visible instead of blank.
 */

/** Collapses every flavour of Unicode space to a plain one. */
const spaces = (v: string) => v.replace(/[\s\u00a0\u202f]+/g, ' ')

const property = (over: Partial<Property> = {}): Property => ({
  id: 1,
  title: 'Prodej bytu 3+kk',
  status: 'active',
  transactionType: 'prodej',
  propertyType: 'byt',
  address: { city: 'Praha' },
  ...over,
})

describe('formatPrice', () => {
  it('formats a sale price in Czech grouping', () => {
    // Normalised: Intl groups with a non-breaking or narrow space depending
    // on the ICU build, and which one is not the thing under test.
    expect(spaces(formatPrice(property({ price: { amount: 8490000 } })))).toBe('8 490 000 Kč')
  })

  it('adds the period only for rentals', () => {
    const rent = { transactionType: 'pronajem' as const, price: { amount: 24500 } }
    expect(formatPrice(property(rent))).toContain('/ měsíc')
    expect(formatPrice(property({ ...rent, price: { amount: 24500, period: 'rok' } }))).toContain('/ rok')
    expect(formatPrice(property({ price: { amount: 24500 } }))).not.toContain('/')
  })

  it('says "on request" rather than rendering a zero or a blank', () => {
    expect(formatPrice(property())).toBe('Cena na vyžádání')
    expect(formatPrice(property({ price: { onRequest: true, amount: 1 } }))).toBe('Cena na vyžádání')
  })
})

describe('pricePerSquareMetre', () => {
  it('divides the price by the usable area', () => {
    expect(pricePerSquareMetre(property({ price: { amount: 8490000 }, usableArea: 78 }))).toContain('Kč / m²')
  })

  it('refuses a rental — rent per m² of a monthly figure is nonsense', () => {
    const rent = property({ transactionType: 'pronajem', price: { amount: 24500 }, usableArea: 78 })
    expect(pricePerSquareMetre(rent)).toBeUndefined()
  })

  it('refuses when either half is missing', () => {
    expect(pricePerSquareMetre(property({ price: { amount: 8490000 } }))).toBeUndefined()
    expect(pricePerSquareMetre(property({ usableArea: 78 }))).toBeUndefined()
    expect(pricePerSquareMetre(property({ price: { onRequest: true, amount: 1 }, usableArea: 78 }))).toBeUndefined()
  })
})

describe('locationLabel', () => {
  it('drops the street when the owner asked for privacy', () => {
    const hidden = property({
      address: { street: 'Dělnická 12', cityPart: 'Holešovice', city: 'Praha 7', hideExactAddress: true },
    })
    expect(locationLabel(hidden)).toBe('Praha 7, Holešovice')
    expect(locationLabel(hidden)).not.toContain('Dělnická')
  })

  it('reads street first when the address is public', () => {
    const open = property({
      address: { street: 'Dělnická 12', cityPart: 'Holešovice', city: 'Praha 7' },
    })
    expect(locationLabel(open)).toBe('Dělnická 12, Holešovice, Praha 7')
  })
})

describe('labels', () => {
  it('translates the Czech disposition convention', () => {
    expect(dispositionLabel('3-kk')).toBe('3+kk')
    expect(dispositionLabel('garsoniera')).toBe('Garsoniéra')
  })

  it('falls through to the raw value so a new CMS option is visible, not blank', () => {
    expect(dispositionLabel('7-kk')).toBe('7-kk')
    expect(energyLabel('Z')).toBe('Z')
  })

  it('returns undefined for an absent value', () => {
    expect(dispositionLabel(null)).toBeUndefined()
    expect(dispositionLabel(undefined)).toBeUndefined()
  })

  it('writes PENB classes the way the certificate does', () => {
    expect(energyLabel('B')).toBe('Třída B — Velmi úsporná')
    expect(energyLabel('EXEMPT')).toBe('Zákonná výjimka')
  })

  it('badges only the statuses a visitor should see', () => {
    expect(statusBadge('sold')).toBe('Prodáno')
    expect(statusBadge('draft')).toBeUndefined()
    expect(statusBadge('active')).toBeUndefined()
  })
})

describe('headings', () => {
  it('builds the card headline from disposition and place', () => {
    const p = property({ disposition: '3-kk', address: { city: 'Praha 7', cityPart: 'Holešovice' } })
    expect(cardTitle(p)).toBe('3+kk Praha 7 Holešovice')
  })

  it('falls back to the listing title when there is nothing to build from', () => {
    expect(cardTitle(property({ address: { city: '' } }))).toBe('Prodej bytu 3+kk')
  })

  it('builds the breadcrumb form from type and disposition', () => {
    expect(propertyHeading(property({ disposition: '3-kk' }))).toBe('Byt 3+kk')
    expect(propertyHeading(property({ propertyType: 'pozemek' }))).toBe('Pozemek')
  })
})

describe('regions', () => {
  it('lists all fourteen kraje', () => {
    expect(CZ_REGIONS).toHaveLength(14)
    expect(regionLabel('vysocina')).toBe('Kraj Vysočina')
  })

  it('counts only regions that have listings — an empty chip is a dead end', () => {
    const counts = regionCounts([
      property({ address: { city: 'Praha', region: 'praha' } }),
      property({ address: { city: 'Praha', region: 'praha' } }),
      property({ address: { city: 'Brno', region: 'jihomoravsky' } }),
      property({ address: { city: 'Nikde' } }),
    ])
    expect(counts).toEqual([
      { value: 'praha', label: 'Hlavní město Praha', count: 2 },
      { value: 'jihomoravsky', label: 'Jihomoravský kraj', count: 1 },
    ])
  })
})

describe('imageUrl', () => {
  it('prefers the requested derivative and falls back to the original', () => {
    const media = { id: 1, url: '/o.jpg', sizes: { card: { url: '/c.jpg' } } }
    expect(imageUrl(media, 'card')).toBe('/c.jpg')
    expect(imageUrl(media, 'hero')).toBe('/o.jpg')
    expect(imageUrl(null)).toBeUndefined()
  })
})

describe('richTextToParagraphs', () => {
  it('flattens a Lexical document to text, nested nodes included', () => {
    const doc = {
      root: {
        children: [
          { type: 'paragraph', children: [{ text: 'První ' }, { text: 'odstavec' }] },
          { type: 'paragraph', children: [{ text: '' }] },
          { type: 'quote', children: [{ children: [{ text: 'Vnořený' }] }] },
        ],
      },
    }
    expect(richTextToParagraphs(doc)).toEqual(['První odstavec', 'Vnořený'])
  })

  it('returns nothing rather than throwing on an absent or malformed value', () => {
    expect(richTextToParagraphs(null)).toEqual([])
    expect(richTextToParagraphs(undefined)).toEqual([])
    expect(richTextToParagraphs({})).toEqual([])
    expect(richTextToParagraphs('nonsense')).toEqual([])
  })
})

describe('formatDate', () => {
  it('formats in cs-CZ and refuses rubbish', () => {
    expect(formatDate('2026-03-09T10:00:00.000Z')).toMatch(/9\.\s*3\.\s*2026/)
    expect(formatDate('not a date')).toBeUndefined()
    expect(formatDate(null)).toBeUndefined()
  })
})
