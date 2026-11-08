/**
 * The shapes a theme consumes.
 *
 * Deliberately hand-written rather than re-exported from the CMS's generated
 * `payload-types`: this is the contract between the platform and every client
 * site, and it should change only when we decide it changes — not whenever
 * someone adds a field in Payload. Widening the CMS schema must not be able to
 * break sixty builds.
 */

export interface MediaSize {
  url?: string | null
  width?: number | null
  height?: number | null
}

export interface Media {
  id: number | string
  alt?: string | null
  url?: string | null
  width?: number | null
  height?: number | null
  mimeType?: string | null
  sizes?: Partial<Record<'thumbnail' | 'card' | 'hero' | 'full', MediaSize>>
}

export type TransactionType = 'prodej' | 'pronajem' | 'drazba'

export type PropertyType =
  | 'byt'
  | 'dum'
  | 'pozemek'
  | 'komercni'
  | 'garaz'
  | 'chata'
  | 'ostatni'

export type ListingStatus = 'draft' | 'active' | 'reserved' | 'sold' | 'rented'

/** A–G plus the two lawful escapes. See zák. č. 406/2000 Sb. */
export type EnergyClass =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  | 'EXEMPT'
  | 'PENDING'

export interface Price {
  amount?: number | null
  onRequest?: boolean | null
  period?: 'mesic' | 'rok' | null
  utilitiesAmount?: number | null
  utilitiesIncluded?: boolean | null
  deposit?: number | null
  commissionIncluded?: boolean | null
  note?: string | null
}

export interface Address {
  street?: string | null
  city: string
  cityPart?: string | null
  zip?: string | null
  region?: string | null
  /** When set, the theme must not render street, exact coordinates, or a pin. */
  hideExactAddress?: boolean | null
  lat?: number | null
  lng?: number | null
}

export interface Penb {
  class?: EnergyClass | null
  exemptionReason?: string | null
  energyKwhM2Year?: number | null
  document?: Media | null
}

export interface GalleryItem {
  image: Media
  alt?: string | null
}

export interface Property {
  id: number | string
  slug?: string | null
  title: string
  status: ListingStatus
  featured?: boolean | null

  transactionType: TransactionType
  propertyType: PropertyType
  disposition?: string | null

  description?: unknown
  price?: Price | null
  address: Address
  penb?: Penb | null

  usableArea?: number | null
  floorArea?: number | null
  landArea?: number | null
  floor?: number | null
  totalFloors?: number | null
  yearBuilt?: number | null

  ownership?: string | null
  buildingType?: string | null
  condition?: string | null
  heating?: string | null
  features?: string[] | null

  gallery?: GalleryItem[] | null
  floorPlan?: Media | null
  virtualTour?: string | null
  videoUrl?: string | null

  availableFrom?: string | null
  referenceId?: string | null
  seo?: { title?: string | null; description?: string | null } | null

  updatedAt?: string
  createdAt?: string
}

export interface Agent {
  name: string
  jobTitle?: string | null
  photo?: Media | null
  bio?: unknown
  phone?: string | null
  email?: string | null
  /** Required on Czech realtor sites by zák. č. 39/2020 Sb. */
  licenceNumber?: string | null
  certifications?: { label?: string | null }[] | null
}

export interface SiteSettings {
  id: number | string
  siteName: string
  hero?: {
    headline?: string | null
    subheadline?: string | null
    ctaLabel?: string | null
    ctaHref?: string | null
    backgroundImage?: Media | null
    /** Cut-out portrait (transparent PNG) layered over the background, as in Figma. */
    portrait?: Media | null
  } | null
  about?: { heading?: string | null; body?: unknown; image?: Media | null } | null
  stats?: { value?: string | null; label?: string | null }[] | null
  agent?: Agent | null
  contact?: {
    companyName?: string | null
    ico?: string | null
    dic?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
    officeHours?: string | null
    mapEmbed?: string | null
    social?: Record<string, string | null | undefined> | null
  } | null
  branding?: {
    logo?: Media | null
    logoInverse?: Media | null
    favicon?: Media | null
  } | null
  legal?: {
    privacyPolicy?: unknown
    cookieNotice?: unknown
    gdprConsentText?: string | null
  } | null
}

export interface Post {
  id: number | string
  slug?: string | null
  title: string
  excerpt?: string | null
  coverImage?: Media | null
  body?: unknown
  category?: string | null
  publishedAt?: string | null
  seo?: { title?: string | null; description?: string | null } | null
}

/**
 * The fixed icon set, matching the `icon` select on the CMS `services`
 * collection.
 *
 * A union rather than `string` so a theme's icon map is checked by the
 * compiler. Every theme must ship all eight: a gap renders an empty box, and
 * only for the clients who use that one service, so it reaches a paying
 * customer before it reaches us. Adding a ninth is therefore a deliberate act
 * that breaks every theme's build until each ships the icon — which is the
 * intent.
 */
export type ServiceIcon =
  | 'home'
  | 'key'
  | 'chart'
  | 'calculator'
  | 'document'
  | 'shield'
  | 'handshake'
  | 'camera'

export interface Service {
  id: number | string
  title: string
  description?: string | null
  icon?: ServiceIcon | null
  order?: number | null
}

export interface Paginated<T> {
  docs: T[]
  totalDocs: number
  page: number
  totalPages: number
  hasNextPage: boolean
}

export interface ListingQuery {
  limit?: number
  page?: number
  status?: ListingStatus | ListingStatus[]
  transactionType?: TransactionType
  propertyType?: PropertyType
  featured?: boolean
  city?: string
  sort?: string
}

/** Payload of the public contact form. */
export interface EnquiryInput {
  name: string
  email?: string
  phone?: string
  message?: string
  propertyId?: number | string
  source?: string
  consent: { given: boolean; text: string }
}
