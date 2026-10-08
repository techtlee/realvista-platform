import { defineSiteConfig } from '@makleri/core/config'
import type { SiteConfig } from '@makleri/core/config'
import type { Media, Post, Property, Service, ServiceIcon, SiteSettings } from '@makleri/core/content'

/**
 * The canonical tenants every theme is rendered against.
 *
 * Not a happy path. Each fixture is a state a real realtor's site has been in,
 * chosen because it is where themes break:
 *
 *   full     — everything filled in, including the listings that have no
 *              disposition, no floor, a legal PENB exemption, a hidden address,
 *              and headings long enough to wrap at every breakpoint.
 *   minimal  — settings null, one listing with only its required fields. This
 *              is day one of a client site, and it is the fixture that catches
 *              the optional-chaining a theme forgot.
 *   empty    — settings filled in, nothing else entered. Catches the theme that
 *              renders "0 nemovitostí" into a heading sized for two digits, or
 *              maps over a list it assumed was non-empty.
 *
 * Czech diacritics appear in every string on purpose: a theme that loads a font
 * without `latin-ext` renders them in a fallback face, and the only way to see
 * it is to have them present.
 */

const image = (id: number, alt: string): Media => ({
  id,
  alt,
  url: `/media/file/fixture-${id}.jpg`,
  width: 1600,
  height: 1067,
  mimeType: 'image/jpeg',
  sizes: {
    thumbnail: { url: `/media/file/fixture-${id}-thumb.webp`, width: 300, height: 200 },
    card: { url: `/media/file/fixture-${id}-card.webp`, width: 640, height: 427 },
    hero: { url: `/media/file/fixture-${id}-hero.webp`, width: 1600, height: 1067 },
  },
})

const lexical = (...paragraphs: string[]) => ({
  root: {
    type: 'root',
    children: paragraphs.map((text) => ({
      type: 'paragraph',
      children: [{ type: 'text', text }],
    })),
  },
})

// ── listings ─────────────────────────────────────────────────────────────────

/** The ordinary case: a sale, fully filled in, six photos. */
const apartment: Property = {
  id: 1,
  slug: 'prodej-bytu-3-kk-praha-holesovice',
  title: 'Prodej bytu 3+kk, 78 m², Praha 7 — Holešovice',
  status: 'active',
  featured: true,
  transactionType: 'prodej',
  propertyType: 'byt',
  disposition: '3-kk',
  description: lexical(
    'Světlý byt 3+kk po kompletní rekonstrukci v cihlovém domě z roku 1931, ' +
      'situovaný ve třetím patře s výtahem.',
    'K bytu náleží sklepní kóje a možnost pronájmu garážového stání v domě.',
  ),
  price: { amount: 8490000, commissionIncluded: true },
  address: {
    street: 'Dělnická 1142/24',
    city: 'Praha 7',
    cityPart: 'Holešovice',
    zip: '170 00',
    region: 'praha',
    lat: 50.1,
    lng: 14.44,
  },
  penb: { class: 'C', energyKwhM2Year: 132 },
  usableArea: 78,
  floor: 3,
  totalFloors: 5,
  yearBuilt: 1931,
  ownership: 'osobni',
  buildingType: 'cihla',
  condition: 'po-rekonstrukci',
  heating: 'ustredni-dalkove',
  features: ['balkon', 'sklep', 'vytah', 'mhd-v-dosahu'],
  gallery: [1, 2, 3, 4, 5, 6].map((n) => ({ image: image(n, `Fotografie ${n}`) })),
  referenceId: 'RV-1042',
}

/** A rental: price carries a period, and per-m² must not be derived from it. */
const rental: Property = {
  id: 2,
  slug: 'pronajem-bytu-2-kk-brno-zabovresky',
  title: 'Pronájem bytu 2+kk, 54 m², Brno — Žabovřesky',
  status: 'active',
  transactionType: 'pronajem',
  propertyType: 'byt',
  disposition: '2-kk',
  description: lexical('Zařízený byt 2+kk s lodžií, k nastěhování ihned.'),
  price: { amount: 18500, period: 'mesic', utilitiesAmount: 3800, deposit: 37000 },
  address: { street: 'Minská 38', city: 'Brno', cityPart: 'Žabovřesky', region: 'jihomoravsky' },
  penb: { class: 'D' },
  usableArea: 54,
  floor: 2,
  totalFloors: 4,
  ownership: 'osobni',
  condition: 'velmi-dobry',
  features: ['lodzie', 'vybaveno'],
  gallery: [{ image: image(7, 'Obývací pokoj') }],
}

/**
 * A plot: no disposition, no floor, no usable area, no heating.
 *
 * The listing that breaks a detail page written against apartments — a theme
 * that renders "Dispozice —" or divides by a missing area fails here.
 */
const plot: Property = {
  id: 3,
  slug: 'prodej-pozemku-ricany',
  title: 'Prodej stavebního pozemku 1 024 m², Říčany u Prahy',
  status: 'active',
  transactionType: 'prodej',
  propertyType: 'pozemek',
  description: lexical('Rovinatý stavební pozemek se všemi sítěmi na hranici.'),
  price: { amount: 5120000 },
  address: { city: 'Říčany', region: 'stredocesky' },
  penb: { class: 'EXEMPT', exemptionReason: 'Pozemek bez stavby — průkaz se nevyhotovuje.' },
  landArea: 1024,
  ownership: 'osobni',
  gallery: [{ image: image(8, 'Pohled na pozemek') }],
}

/**
 * The privacy case: the owner does not want the home findable.
 *
 * `hideExactAddress` must suppress the street everywhere, including a card
 * subtitle and a map pin. A theme that leaks it defeats the point of the flag.
 */
const discreet: Property = {
  id: 4,
  slug: 'prodej-vily-cerna-v-posumavi',
  title: 'Prodej vily 6+kk s bazénem, 412 m², Černá v Pošumaví',
  status: 'reserved',
  transactionType: 'prodej',
  propertyType: 'dum',
  disposition: '6-a-vice',
  description: lexical('Reprezentativní vila s výhledem na Lipno.'),
  price: { onRequest: true },
  address: {
    street: 'Jestřábí 118',
    city: 'Černá v Pošumaví',
    region: 'jihocesky',
    hideExactAddress: true,
    lat: 48.74,
    lng: 14.11,
  },
  penb: { class: 'PENDING' },
  usableArea: 412,
  landArea: 2860,
  yearBuilt: 2019,
  ownership: 'osobni',
  condition: 'novostavba',
  heating: 'tepelne-cerpadlo',
  features: ['bazen', 'garaz', 'zahrada', 'krb', 'klimatizace', 'bezbarierovy'],
  gallery: [9, 10].map((n) => ({ image: image(n, `Exteriér ${n}`) })),
}

/** No photos, no price, every optional empty — and a heading that wraps. */
const bare: Property = {
  id: 5,
  slug: 'nabidka-bez-fotografii',
  title:
    'Prodej nebytového prostoru v původním stavu určeného k rekonstrukci, ' +
    'Ústí nad Labem — Předlice, Žižkova třída',
  status: 'active',
  transactionType: 'prodej',
  propertyType: 'komercni',
  address: { city: 'Ústí nad Labem', region: 'ustecky' },
}

const sold: Property = {
  ...apartment,
  id: 6,
  slug: 'prodano-dum-olomouc',
  title: 'Rodinný dům 5+1, 186 m², Olomouc — Nová Ulice',
  status: 'sold',
  featured: false,
  propertyType: 'dum',
  disposition: '5-1',
  address: { city: 'Olomouc', cityPart: 'Nová Ulice', region: 'olomoucky' },
  usableArea: 186,
  gallery: [{ image: image(11, 'Zahrada') }],
}

// ── posts, services, settings ────────────────────────────────────────────────

const posts: Post[] = [
  {
    id: 1,
    slug: 'jak-pripravit-byt-na-prodej',
    title: 'Jak připravit byt na prodej, aby se neprodával půl roku',
    excerpt:
      'Čtyři zásahy, které se vyplatí udělat před focením, a jeden, který se nevyplatí nikdy.',
    coverImage: image(12, 'Příprava bytu'),
    body: lexical(
      'První dojem z fotografií rozhoduje o tom, kolik prohlídek vůbec proběhne.',
      'Nejčastější chybou je focení v protisvětle — ne nepořádek, jak se běžně tvrdí.',
    ),
    category: 'prodej',
    publishedAt: '2026-09-14T08:00:00.000Z',
  },
  {
    id: 2,
    slug: 'penb-co-to-znamena',
    title: 'PENB: co znamenají třídy A až G a kdy ho nepotřebujete',
    excerpt: 'Průkaz energetické náročnosti je povinný ze zákona. Má ale dvě výjimky.',
    coverImage: image(13, 'Energetický štítek'),
    body: lexical('Zákon č. 406/2000 Sb. ukládá uvést třídu už v inzerátu.'),
    category: 'pravo',
    publishedAt: '2026-08-02T08:00:00.000Z',
  },
  {
    id: 3,
    slug: 'hypoteka-2026',
    title: 'Hypotéky v roce 2026',
    // No excerpt and no cover image on purpose — the realtor skipped both.
    body: lexical('Sazby se stabilizovaly kolem čtyř procent.'),
    publishedAt: '2026-07-21T08:00:00.000Z',
  },
]

const ICONS: ServiceIcon[] = [
  'home',
  'key',
  'chart',
  'calculator',
  'document',
  'shield',
  'handshake',
  'camera',
]

const SERVICE_TITLES: Record<ServiceIcon, string> = {
  home: 'Prodej nemovitosti',
  key: 'Pronájem a správa',
  chart: 'Tržní odhad zdarma',
  calculator: 'Hypoteční poradenství',
  document: 'Právní servis a úschova',
  shield: 'Výkup nemovitostí',
  handshake: 'Výkup podílů a exekuce',
  camera: 'Home staging a fotografie',
}

/** One per icon, so a theme missing an icon is caught by rendering, not review. */
const services: Service[] = ICONS.map((icon, i) => ({
  id: i + 1,
  title: SERVICE_TITLES[icon] as string,
  description: 'Postarám se o celý proces od ocenění po předání klíčů.',
  icon,
  order: i,
}))

const settings: SiteSettings = {
  id: 1,
  siteName: 'Reality Nováková',
  hero: {
    headline: 'Reality nejsou jen nemovitosti. Jsou to vaše další kroky.',
    subheadline: 'Prodávám byty a domy v Praze a okolí už čtrnáctým rokem.',
    ctaLabel: 'Prohlédnout nabídku',
    ctaHref: '/nemovitosti',
    backgroundImage: image(14, 'Interiér bytu'),
  },
  about: {
    heading: 'Každý prodej je rozhodnutí o tom, kde budete bydlet dál.',
    body: lexical('Pracuji sama, takže klient mluví pořád se mnou.'),
    image: image(15, 'Portrét'),
  },
  stats: [
    { value: '412', label: 'prodaných nemovitostí' },
    { value: '14', label: 'let na trhu' },
    { value: '98 %', label: 'spokojených klientů' },
  ],
  agent: {
    name: 'Markéta Nováková',
    jobTitle: 'Realitní makléřka',
    photo: image(16, 'Markéta Nováková'),
    bio: lexical('Specializuji se na byty v širším centru Prahy.'),
    phone: '+420 777 123 456',
    email: 'novakova@realitynovakova.cz',
    licenceNumber: 'RM-2019-04417',
    certifications: [{ label: 'Certifikovaný realitní makléř ČR' }],
  },
  contact: {
    companyName: 'Reality Nováková s.r.o.',
    ico: '09182736',
    dic: 'CZ09182736',
    address: 'Dělnická 1142/24\n170 00 Praha 7 — Holešovice',
    phone: '+420 777 123 456',
    email: 'info@realitynovakova.cz',
    officeHours: 'Po–Pá 9:00–17:00',
    social: { instagram: 'https://instagram.com/realitynovakova' },
  },
  branding: { logo: image(17, 'Logo'), favicon: image(18, 'Favicon') },
  legal: {
    privacyPolicy: lexical('Správcem osobních údajů je Reality Nováková s.r.o.'),
    cookieNotice: lexical('Používáme pouze technické cookies.'),
    gdprConsentText: 'Souhlasím se zpracováním osobních údajů za účelem vyřízení poptávky.',
  },
}

/** Only what the CMS marks required — the shape on day one of a client site. */
const minimalSettings: SiteSettings = { id: 1, siteName: 'Reality Dvořák' }

const minimalListing: Property = {
  id: 1,
  slug: 'novy-inzerat',
  title: 'Prodej bytu, Kladno',
  status: 'active',
  transactionType: 'prodej',
  propertyType: 'byt',
  address: { city: 'Kladno' },
}

// ── fixtures ─────────────────────────────────────────────────────────────────

export interface ThemeFixture {
  /** Stable id, used in conformance test names. */
  name: string
  /** What this fixture is for — read it before changing the data. */
  description: string
  site: SiteConfig
  settings: SiteSettings | null
  listings: Property[]
  posts: Post[]
  services: Service[]
}

const siteConfig = (siteId: string, variant: string): SiteConfig =>
  defineSiteConfig({
    siteId,
    theme: { name: 'fixture', variant },
    domain: `${siteId}.cz`,
    cms: { url: 'http://localhost:3000', tenantId: 1 },
    pages: { home: { sections: ['hero', 'featured', 'stats', 'services', 'agent', 'contact'] } },
  })

/**
 * Builds the three fixtures for a given colourway.
 *
 * Variant is a parameter because conformance renders every fixture in every
 * variant the theme declares: a colourway is a different set of CSS tokens, and
 * a page that renders in indigo can still be unreadable in crimson.
 */
export function themeFixtures(variant: string): ThemeFixture[] {
  return [
    {
      name: 'full',
      description:
        'An established realtor: every field filled, six listings covering a sale, ' +
        'a rental, a plot with no disposition, a PENB exemption, a hidden address, ' +
        'a listing with no photos, and one sold.',
      site: siteConfig('reality-novakova', variant),
      settings,
      listings: [apartment, rental, plot, discreet, bare, sold],
      posts,
      services,
    },
    {
      name: 'minimal',
      description:
        'Day one: no site settings at all, one listing with only required fields. ' +
        'The null-guard fixture — a theme that assumes settings exist fails here.',
      site: siteConfig('reality-dvorak', variant),
      settings: null,
      listings: [minimalListing],
      posts: [],
      services: [],
    },
    {
      name: 'empty',
      description:
        'Settings filled in, nothing entered yet: no listings, no posts, no services. ' +
        'Catches the theme that maps over a list it assumed was non-empty.',
      site: siteConfig('reality-zacatek', variant),
      settings: minimalSettings,
      listings: [],
      posts: [],
      services: [],
    },
  ]
}

/** Strings that must survive rendering, as a font/encoding canary. */
export const CZECH_DIACRITICS = 'ěščřžýáíéůúďťň'

export const fixtureListings = { apartment, rental, plot, discreet, bare, sold }
export const fixtureSettings = settings
export const fixturePosts = posts
export const fixtureServices = services
export const SERVICE_ICONS = ICONS
