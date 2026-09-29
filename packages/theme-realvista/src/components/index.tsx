import type { Media, Property, SiteSettings } from '@makleri/core/content'
import type { ReactNode } from 'react'

/**
 * REALVISTA's building blocks.
 *
 * Exported so a client repo can *wrap* a default rather than reimplement it —
 * wrapping survives a theme minor, replacing does not. All of these are Server
 * Components: nothing here may import client-only APIs, because server
 * rendering of listing pages is the whole SEO story.
 */

/**
 * URL for an uploaded image.
 *
 * Payload returns media URLs relative to its own origin
 * (`/api/media/file/x.webp`). They are deliberately left relative so they
 * resolve against the SITE, which proxies them under the same path using its
 * tenant-scoped key — see app/api/media/file in the site template.
 *
 * Media cannot simply be made public on the CMS: a public `<img>` tag cannot
 * carry an API key, but opening the collection would also let one realtor
 * enumerate another's files. Proxying keeps the isolation boundary intact.
 *
 * In production the R2 adapter returns absolute URLs on the bucket's own
 * public domain, and those pass through untouched.
 */
export function imageUrl(
  media: Media | null | undefined,
  size: 'thumbnail' | 'card' | 'hero' | 'full' = 'card',
) {
  if (!media) return undefined
  return media.sizes?.[size]?.url ?? media.url ?? undefined
}

/** Czech price formatting: `8 490 000 Kč`, with a rental period when relevant. */
export function formatPrice(p: Property): string {
  const price = p.price
  if (!price || price.onRequest || price.amount == null) return 'Cena na vyžádání'

  const amount = new Intl.NumberFormat('cs-CZ').format(price.amount)
  const suffix = p.transactionType === 'pronajem' ? (price.period === 'rok' ? ' / rok' : ' / měsíc') : ''
  return `${amount} Kč${suffix}`
}

const DISPOSITION_LABELS: Record<string, string> = {
  garsoniera: 'Garsoniéra', '1-kk': '1+kk', '1-1': '1+1', '2-kk': '2+kk', '2-1': '2+1',
  '3-kk': '3+kk', '3-1': '3+1', '4-kk': '4+kk', '4-1': '4+1', '5-kk': '5+kk', '5-1': '5+1',
  '6-a-vice': '6 a více', atypicky: 'Atypický',
}

export function dispositionLabel(v?: string | null) {
  return v ? (DISPOSITION_LABELS[v] ?? v) : undefined
}

/** Location line, honouring the listing's privacy flag. */
export function locationLabel(p: Property): string {
  const a = p.address
  if (!a) return ''
  const parts = a.hideExactAddress
    ? [a.city, a.cityPart]
    : [a.street, a.cityPart, a.city]
  return parts.filter(Boolean).join(', ')
}

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>
}

export function Section({
  children,
  className = '',
  alt = false,
  id,
}: {
  children: ReactNode
  className?: string
  alt?: boolean
  id?: string
}) {
  return (
    <section id={id} className={`${alt ? 'bg-surface-alt' : 'bg-surface'} py-14 sm:py-20 ${className}`}>
      <Container>{children}</Container>
    </section>
  )
}

export function SectionHeading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-8 sm:mb-10">
      <h2 className="font-display text-2xl leading-tight text-ink sm:text-3xl">{children}</h2>
      {sub ? <p className="mt-2 max-w-2xl text-ink-muted">{sub}</p> : null}
    </div>
  )
}

export function Button({
  href,
  children,
  variant = 'solid',
}: {
  href: string
  children: ReactNode
  variant?: 'solid' | 'outline'
}) {
  const base =
    'inline-flex items-center justify-center rounded-[var(--radius-card)] px-5 py-3 text-sm font-medium transition-colors'
  const styles =
    variant === 'solid'
      ? 'bg-brand-600 text-on-brand hover:bg-brand-700'
      : 'border border-line text-ink hover:bg-surface-alt'
  return (
    <a href={href} className={`${base} ${styles}`}>
      {children}
    </a>
  )
}

/** PENB badge. Legally required on Czech listings, so it is never optional chrome. */
export function EnergyBadge({ value }: { value?: string | null }) {
  if (!value) return null

  const label =
    value === 'EXEMPT' ? 'PENB: výjimka' : value === 'PENDING' ? 'PENB: zpracovává se' : `PENB ${value}`

  return (
    <span className="inline-flex items-center rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted">
      {label}
    </span>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
      {children}
    </span>
  )
}

const STATUS_LABELS: Record<string, string> = {
  reserved: 'Rezervováno',
  sold: 'Prodáno',
  rented: 'Pronajato',
}

export function PropertyCard({ property }: { property: Property }) {
  const cover = property.gallery?.[0]?.image
  const src = imageUrl(cover, 'card')
  const status = STATUS_LABELS[property.status]
  const disposition = dispositionLabel(property.disposition)

  return (
    <a
      href={`/nemovitosti/${property.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[3/2] overflow-hidden bg-surface-alt">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={cover?.alt ?? property.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : null}
        {status ? (
          <span className="absolute left-3 top-3 rounded-full bg-ink/85 px-3 py-1 text-xs font-medium text-white">
            {status}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-base leading-snug text-ink">{property.title}</h3>
        <p className="text-sm text-ink-muted">{locationLabel(property)}</p>

        <div className="mt-1 flex flex-wrap gap-1.5">
          {disposition ? <Badge>{disposition}</Badge> : null}
          {property.usableArea ? <Badge>{property.usableArea} m²</Badge> : null}
          <EnergyBadge value={property.penb?.class} />
        </div>

        <p className="mt-auto pt-3 font-display text-lg text-brand-700">{formatPrice(property)}</p>
      </div>
    </a>
  )
}

export function Header({ settings }: { settings: SiteSettings | null }) {
  const nav = [
    { href: '/nemovitosti', label: 'Nabídka nemovitostí' },
    { href: '/#sluzby', label: 'Služby' },
    { href: '/#o-mne', label: 'O mně' },
    { href: '/#kontakt', label: 'Kontakt' },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-6">
        <a href="/" className="font-display text-lg tracking-tight text-ink">
          {settings?.siteName ?? 'REALVISTA'}
        </a>
        <nav className="hidden items-center gap-6 md:flex">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="text-sm text-ink-muted transition-colors hover:text-ink">
              {n.label}
            </a>
          ))}
        </nav>
        {settings?.agent?.phone ? (
          <a
            href={`tel:${settings.agent.phone.replace(/\s/g, '')}`}
            className="hidden rounded-[var(--radius-card)] bg-brand-600 px-4 py-2 text-sm font-medium text-on-brand sm:inline-flex"
          >
            {settings.agent.phone}
          </a>
        ) : null}
      </Container>
    </header>
  )
}

export function Footer({ settings }: { settings: SiteSettings | null }) {
  const c = settings?.contact
  return (
    <footer className="bg-brand-900 py-12 text-white/80">
      <Container className="grid gap-8 sm:grid-cols-3">
        <div>
          <p className="font-display text-lg text-white">{settings?.siteName ?? 'REALVISTA'}</p>
          {c?.companyName ? <p className="mt-2 text-sm">{c.companyName}</p> : null}
          {c?.ico ? <p className="text-sm">IČO {c.ico}</p> : null}
          {c?.dic ? <p className="text-sm">DIČ {c.dic}</p> : null}
        </div>
        <div>
          <p className="text-sm font-medium text-white">Kontakt</p>
          {c?.phone ? <p className="mt-2 text-sm">{c.phone}</p> : null}
          {c?.email ? <p className="text-sm">{c.email}</p> : null}
          {c?.address ? <p className="mt-2 whitespace-pre-line text-sm">{c.address}</p> : null}
        </div>
        <div>
          <p className="text-sm font-medium text-white">Informace</p>
          <p className="mt-2 text-sm">
            <a href="/zasady-ochrany-osobnich-udaju" className="hover:text-white">
              Zásady ochrany osobních údajů
            </a>
          </p>
          {settings?.agent?.licenceNumber ? (
            <p className="mt-2 text-xs text-white/60">
              Osvědčení realitního zprostředkovatele č. {settings.agent.licenceNumber}
            </p>
          ) : null}
        </div>
      </Container>
      <Container className="mt-8 border-t border-white/15 pt-6">
        <p className="text-xs text-white/50">
          © {new Date().getFullYear()} {settings?.siteName ?? ''}. Všechna práva vyhrazena.
        </p>
      </Container>
    </footer>
  )
}
