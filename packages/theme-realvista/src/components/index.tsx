import type { SiteConfig } from '@makleri/core/config'
import type { Post, Property, Service, SiteSettings } from '@makleri/core/content'
import {
  cardTitle,
  featureLabel,
  formatDate,
  formatPrice,
  imageUrl,
  richTextToParagraphs,
  statusBadge,
} from '@makleri/core/format'
import type { ReactNode } from 'react'

import { ArrowRightIcon, ServiceGlyph } from '../icons.js'

export { PropertyMap, mapView, osmEmbedUrl } from './PropertyMap.js'
// The component only: anything else exported from a 'use client' module becomes
// a client reference on the server and cannot be called there.
export { MortgageCalculator } from './MortgageCalculator.js'

/**
 * REALVISTA building blocks, matching the Figma CSS export.
 *
 * The design is drawn on a 1440px canvas with 70px gutters — a 1300px content
 * column. That is expressed here as a max-width plus responsive padding rather
 * than the absolute positioning of the export, so the same components work on a
 * phone. Type sizes, colours, radii and the card shadow are taken verbatim.
 *
 * Exported so a client repo can *wrap* a default rather than reimplement it.
 * All Server Components: nothing here may import client-only APIs, because
 * server rendering of listing pages is the whole SEO story.
 *
 * Nothing here formats a price, a disposition or an address. That is
 * `@makleri/core/format`, shared by every theme — "Třída B" has to mean the
 * same thing to a buyer whichever layout their realtor bought.
 */

/**
 * 1440 canvas − 2×70 gutters = 1300 of content.
 *
 * Expressed as 1364 = 1300 + the 32px gutter on each side, so the gutter never
 * switches off. It used to be `max-w-[1300px] xl:px-0`, which put every line
 * of text flush against the window edge on a 1280–1363px laptop screen.
 */
export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1364px] px-5 sm:px-8 ${className}`}>{children}</div>
}

/** 200×50, 5px radius, brand fill. */
export function SolidButton({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      className={`inline-flex h-[50px] items-center justify-center rounded-btn bg-brand px-8 text-[16px] font-medium leading-[20px] text-white transition-opacity hover:opacity-90 ${className}`}
    >
      {children}
    </a>
  )
}

/** Same footprint, brand outline — the "Zavolat makléři" treatment. */
export function OutlineButton({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      className={`inline-flex h-[50px] items-center justify-center rounded-btn border border-brand px-8 text-[16px] font-medium leading-[21px] text-brand transition-colors hover:bg-brand hover:text-white ${className}`}
    >
      {children}
    </a>
  )
}

/** White outline pill, used on the dark promo tile. */
export function GhostButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-[50px] min-w-[200px] items-center justify-center rounded-[50px] border border-white px-6 text-[16px] font-medium leading-[20px] text-white transition-colors hover:bg-white/10"
    >
      {children}
    </a>
  )
}

/** Region filter chip: 50px pill, accent fill, count in a white circle. */
export function RegionChip({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <a href={href} className="inline-flex h-[50px] shrink-0 items-center gap-2.5 rounded-pill bg-accent px-5">
      <span className="text-[12px] font-semibold leading-[20px] text-brand">{label}</span>
      <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white text-[12px] font-semibold leading-[20px] text-brand">
        {count}
      </span>
    </a>
  )
}

/** Small 28px spec pill used on the detail page. */
export function SpecPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[28px] items-center rounded-[16px] bg-accent px-3 text-[12px] font-semibold leading-[16px] text-brand">
      {children}
    </span>
  )
}

/**
 * 420-wide listing card: 235px image, 100px white info block, soft shadow.
 *
 * Corners are 5px, split between the photo (top) and the info block (bottom)
 * so the shadow stays on the info block alone, as drawn.
 */
export function PropertyCard({ property }: { property: Property }) {
  const cover = property.gallery?.[0]?.image
  const src = imageUrl(cover, 'card')
  const photoCount = property.gallery?.length ?? 0
  // Only the statuses worth showing a visitor; draft and active render nothing.
  const status = statusBadge(property.status)
  const firstFeature = property.features?.[0]

  return (
    <a href={`/nemovitosti/${property.slug}`} className="group block">
      <div className="relative h-[235px] overflow-hidden rounded-t-btn bg-accent">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={cover?.alt ?? property.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : null}

        {/* 44px frosted tile, 10px in from the corner, hairline white edge. */}
        {photoCount > 1 ? (
          <span className="rv-track absolute bottom-[10px] right-[10px] inline-flex h-11 w-11 items-center justify-center rounded-btn border border-white/60 bg-white/20 text-[10px] font-bold leading-[20px] text-brand backdrop-blur-sm">
            +{photoCount - 1}
          </span>
        ) : null}

        {status ? (
          <span className="absolute left-3 top-3 rounded-btn bg-brand px-3 py-1 text-[12px] font-semibold text-white">
            {status}
          </span>
        ) : null}
      </div>

      {/* 20 + 20 title + 11 + 20 price + 29 = the 100px block in the design. */}
      <div className="flex min-h-[100px] items-start justify-between gap-4 rounded-b-btn bg-card px-[30px] pb-[29px] pt-[20px] shadow-card">
        <div>
          <p className="text-[16px] font-bold leading-[20px] text-brand">{cardTitle(property)}</p>
          <p className="rv-track mt-[11px] text-[16px] leading-[20px] text-brand">{formatPrice(property)}</p>
        </div>
        <div className="shrink-0 text-right">
          {property.usableArea ? (
            <p className="text-[16px] leading-[21px] text-muted">{property.usableArea} m²</p>
          ) : null}
          {firstFeature ? (
            <p className="mt-[10px] text-[16px] leading-[21px] text-muted">{featureLabel(firstFeature)}</p>
          ) : null}
        </div>
      </div>
    </a>
  )
}

/** The gradient "Dalších 10+" tile that closes the grid. */
export function MorePropertiesCard({ count, href }: { count: number; href: string }) {
  return (
    <div className="rv-promo flex min-h-[335px] flex-col items-center justify-center rounded-btn p-8 text-center shadow-card">
      <p className="text-[16px] font-bold leading-[20px] text-white">Dalších</p>
      <p className="mt-[10px] text-[60px] font-medium leading-[67px] text-white">{count}+</p>
      <p className="mt-[10px] max-w-[224px] text-[16px] font-bold leading-[20px] text-white">
        Nemovitostí na vás čeká v naší nabídce
      </p>
      <div className="mt-[40px]">
        <GhostButton href={href}>Zobrazit více</GhostButton>
      </div>
    </div>
  )
}

/**
 * Header links, honouring the site's modules.
 *
 * `/blog` is linked only when `features.blog` is on: the client repo 404s the
 * blog routes when it is off, and the configurator sells the switch.
 */
export function navItems(site: SiteConfig): { href: string; label: string }[] {
  return [
    { href: '/nemovitosti', label: 'Nemovitosti' },
    { href: '/#kontakt', label: 'Kontakt' },
    ...(site.features.blog ? [{ href: '/blog', label: 'Blog' }] : []),
    { href: '/#o-makleri', label: 'O Makléři' },
  ]
}

/**
 * Nav sits over the hero on the homepage and on the page background elsewhere.
 * `overlay` keeps it transparent and absolutely placed, matching the export.
 *
 * Rendered once per page, first. `site` is required so the links can follow
 * the modules the realtor bought.
 */
export function Header({
  settings,
  site,
  overlay = false,
}: {
  settings: SiteSettings | null
  site: SiteConfig
  overlay?: boolean
}) {
  // Over the hero the nav takes the hero's ink (white on crimson and clay,
  // brand indigo on indigo); elsewhere it always sits on the page background.
  const ink = overlay ? 'text-hero-ink' : 'text-brand'
  const nav = navItems(site)

  return (
    <header className={overlay ? 'absolute inset-x-0 top-0 z-40' : 'relative z-40'}>
      <Container className="flex h-[60px] items-center justify-between gap-6">
        <a href="/" className={`rv-track text-[16px] leading-[20px] ${ink}`}>
          {settings?.siteName ?? 'Realvista'}
        </a>
        <nav aria-label="Hlavní navigace" className="hidden items-center gap-10 md:flex">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className={`rv-track text-[16px] leading-[20px] ${ink} hover:opacity-70`}>
              {n.label}
            </a>
          ))}
        </nav>

        {/*
          Below md the nav above is hidden, and a phone visitor used to get
          nothing in its place. <details> opens and closes without JavaScript,
          so the header stays a Server Component and works before hydration.
        */}
        <details className="group md:hidden">
          <summary
            aria-label="Menu"
            className={`grid h-10 w-10 cursor-pointer list-none place-items-center ${ink} [&::-webkit-details-marker]:hidden`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <path className="group-open:hidden" d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" />
              <path className="hidden group-open:block" d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" />
            </svg>
          </summary>
          <nav aria-label="Menu" className="absolute inset-x-0 top-[60px] bg-card shadow-card">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rv-track block border-b border-accent px-5 py-4 text-[16px] leading-[20px] text-brand sm:px-8"
              >
                {n.label}
              </a>
            ))}
          </nav>
        </details>
      </Container>
    </header>
  )
}

/**
 * Shared contact block: 60px heading left, underlined form right.
 *
 * The section owns the 150px above it and nothing below: what follows decides
 * its own gap (the blog teaser, or the footer's 200px). Columns are 640 + 20 +
 * 640, so the form starts on the canvas's centre line as drawn.
 */
export function ContactSection({
  settings,
  action = '/api/poptavka',
  propertyId,
}: {
  settings: SiteSettings | null
  /** Where the form posts. The client repo owns the route (`/api/poptavka`). */
  action?: string
  /** Set on a listing page so the enquiry arrives attached to that listing. */
  propertyId?: number | string
}) {
  const c = settings?.contact
  const line =
    'w-full border-0 border-b border-muted bg-transparent pb-[10px] text-[16px] font-medium leading-[20px] text-brand outline-none placeholder:text-muted focus:border-brand'
  const label = 'mb-[10px] block text-[16px] font-medium leading-[20px] text-brand'
  const box = 'h-[30px] w-[30px] shrink-0 rounded-btn border border-muted accent-[var(--rv-brand)]'

  return (
    <section id="kontakt" className="pt-[100px] lg:pt-[150px]">
      <Container className="grid gap-16 lg:grid-cols-2 lg:gap-x-5">
        <div>
          <h2 className="max-w-[504px] text-[40px] font-medium leading-[45px] text-brand sm:text-[60px] sm:leading-[67px]">
            Máte zájem o naše služby?
          </h2>
          {c?.email ? (
            <p className="rv-track mt-10 text-[16px] leading-[20px] text-brand lg:mt-[77px]">{c.email}</p>
          ) : null}
          {/* Address and phone read as one block, bottom-aligned with the consent row. */}
          {c?.address || c?.phone ? (
            <div className="mt-8 lg:mt-[107px]">
              {c?.address ? (
                <p className="rv-track whitespace-pre-line text-[16px] font-bold leading-[20px] text-brand">
                  {c.address}
                </p>
              ) : null}
              {c?.phone ? <p className="rv-track text-[16px] leading-[20px] text-brand">{c.phone}</p> : null}
            </div>
          ) : null}
        </div>

        <div>
          <h3 className="text-[30px] font-medium leading-[36px] text-brand">Pojďme se spojit</h3>
          <form method="post" action={action} className="mt-[50px]">
            {propertyId != null ? (
              <input type="hidden" name="propertyId" value={String(propertyId)} />
            ) : null}

            {/*
              Honeypot. People never see or reach it; bots that fill every field
              do, and /api/poptavka drops any enquiry where it is not empty.
              Moved off-screen rather than display:none, which some bots skip.
            */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Web
                <input name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" />
              </label>
            </div>

            {/*
              Name | e-mail, then the message, as drawn. The phone field is not
              in the design; it is kept (optional, half width) because a realtor
              calls back far more often than they write.
            */}
            <div className="grid gap-x-5 gap-y-10 sm:grid-cols-2">
              <label className="block">
                <span className={label}>Jméno a příjmení</span>
                <input name="name" required placeholder="Vaše jméno" className={line} />
              </label>
              <label className="block">
                <span className={label}>E-mail</span>
                <input name="email" type="email" placeholder="E-mail" className={line} />
              </label>
              <label className="block">
                <span className={label}>Telefon</span>
                <input name="phone" type="tel" autoComplete="tel" placeholder="Nepovinné" className={line} />
              </label>
            </div>

            <label className="mt-10 block">
              <span className={label}>Zpráva</span>
              <textarea
                name="message"
                placeholder="Zde napište o co máte zájem"
                className={`${line} block h-[100px] resize-none`}
              />
            </label>

            <div className="mt-[18px] grid gap-5 sm:grid-cols-2">
              <label className="flex items-center gap-[10px]">
                <input type="checkbox" name="consent" required className={box} />
                <span className="text-[12px] font-medium leading-[20px] text-brand">
                  {settings?.legal?.gdprConsentText ?? 'Souhlasím se zpracováním osobních údajů'}
                </span>
              </label>
              <label className="flex items-center gap-[10px]">
                <input type="checkbox" name="noNewsletter" className={box} />
                <span className="text-[12px] font-medium leading-[20px] text-brand">
                  Nesouhlasím se zasíláním novinek
                </span>
              </label>
            </div>

            <button
              type="submit"
              className="mt-10 h-[50px] w-full rounded-btn bg-brand text-[16px] font-medium leading-[20px] text-white transition-opacity hover:opacity-90"
            >
              Odeslat
            </button>
          </form>
        </div>
      </Container>
    </section>
  )
}

/**
 * 650px band on the 1440 canvas: 150 above the wordmark, columns at
 * 70 / 580 / 850 / 1080, the legal row 170 below the newsletter box and 100
 * above the bottom edge. The footer owns the 200px gap above it, which is what
 * the design leaves after the contact form on a listing page.
 */
export function Footer({ settings, site }: { settings: SiteSettings | null; site: SiteConfig }) {
  const c = settings?.contact
  const name = settings?.siteName ?? 'REALVISTA'
  // One address line per row, at the same 36px rhythm as phone and e-mail.
  const addressLines = (c?.address ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

  return (
    <footer className="mt-[120px] bg-brand pb-[60px] pt-[100px] lg:mt-[200px] lg:pb-[100px] lg:pt-[150px]">
      <Container className="grid gap-12 sm:grid-cols-2 xl:grid-cols-[510fr_270fr_230fr_290fr] xl:gap-0">
        <div className="sm:col-span-2 xl:col-span-1">
          <p className="rv-track text-[46px] font-bold leading-[60px] text-white">{name}</p>
          <p className="max-w-[420px] text-[16px] leading-[24px] text-footer-ink">
            {settings?.hero?.subheadline ?? ''}
          </p>
        </div>

        <div>
          <p className="text-[18px] font-bold leading-[23px] text-white">Menu</p>
          <ul className="mt-4 space-y-4">
            {[
              { href: '/#o-makleri', label: 'O Makléři' },
              { href: '/nemovitosti', label: 'Nabízené nemovitosti' },
              { href: '/nemovitosti?stav=prodano', label: 'Prodané nemovitosti' },
              ...(site.features.blog ? [{ href: '/blog', label: 'Blog & Poradna' }] : []),
            ].map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-[15px] leading-[20px] text-footer-ink hover:text-white">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[18px] font-bold leading-[23px] text-white">Kancelář</p>
          <ul className="mt-4 space-y-4 text-[15px] leading-[20px] text-footer-ink">
            {addressLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {c?.phone ? <li>{c.phone}</li> : null}
            {c?.email ? <li>{c.email}</li> : null}
          </ul>
        </div>

        <div className="rounded-btn border border-white/10 bg-white/5 px-[19px] pb-6 pt-[23px] xl:-mt-[10px] xl:h-[220px] xl:pb-0">
          <p className="text-[16px] font-bold leading-[21px] text-white">Odebírat novinky</p>
          <p className="mt-[5px] max-w-[250px] text-[13px] leading-[18px] text-footer-ink">
            Buďte první, kdo se dozví o nových prémiových nemovitostech.
          </p>
          <div className="mt-6 flex max-w-[250px] items-center justify-between gap-3 rounded-btn bg-white px-4 py-3">
            <input
              type="email"
              placeholder="Váš e-mail..."
              aria-label="Váš e-mail"
              className="w-full bg-transparent text-[13px] leading-[17px] text-brand outline-none placeholder:text-muted"
            />
            <ArrowRightIcon className="shrink-0 text-brand" />
          </div>
        </div>
      </Container>

      <Container className="mt-16 flex flex-wrap items-center justify-between gap-4 xl:mt-[170px]">
        <p className="text-[15px] leading-[20px] text-footer-ink">
          © {new Date().getFullYear()} {name}. Všechna práva vyhrazena.
          {settings?.agent?.licenceNumber ? ` Osvědčení č. ${settings.agent.licenceNumber}` : ''}
        </p>
        <div className="flex gap-6">
          <a href="/zasady-ochrany-osobnich-udaju" className="text-[15px] leading-[20px] text-footer-ink hover:text-white">
            GDPR
          </a>
          <a href="/cookies" className="text-[15px] leading-[20px] text-footer-ink hover:text-white">
            Cookies
          </a>
        </div>
      </Container>
    </footer>
  )
}

/**
 * Lexical rich text, as REALVISTA paragraphs.
 *
 * The flattening itself is `@makleri/core/format` — a theme decides the element
 * and the spacing, not what the document says.
 */
export function RichText({ value, className = '' }: { value: unknown; className?: string }) {
  const paragraphs = richTextToParagraphs(value)
  if (paragraphs.length === 0) return null

  return (
    <div className={className}>
      {paragraphs.map((text, i) => (
        <p key={i} className="mb-4 last:mb-0">
          {text}
        </p>
      ))}
    </div>
  )
}

/**
 * Services.
 *
 * This section had no implementation at all: `services` was a required prop on
 * the homepage, passed from the client repo, and never rendered. A realtor
 * filling in the Služby collection saw nothing appear on their site.
 */
export function ServicesSection({ services }: { services: Service[] }) {
  if (services.length === 0) return null

  return (
    <section id="sluzby" className="pt-[150px]">
      <Container>
        <h2 className="text-[30px] font-medium leading-[36px] text-brand">Co pro vás zajistím</h2>
        <p className="rv-track mt-4 max-w-[520px] text-[16px] leading-[20px] text-brand">
          Od prvního ocenění po předání klíčů.
        </p>

        <div className="mt-[50px] grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {services.map((s) => (
            <div key={s.id} className="bg-card p-[30px] shadow-card">
              <ServiceGlyph icon={s.icon} className="h-8 w-8 text-brand" />
              <p className="mt-6 text-[16px] font-bold leading-[20px] text-brand">{s.title}</p>
              {s.description ? (
                <p className="rv-track mt-3 text-[16px] leading-[22px] text-muted">{s.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}

/**
 * Blog card: 235px cover over a 180px info block. Tighter than the listing
 * card: 20px inset, and the date sits directly under the title.
 */
export function PostCard({ post }: { post: Post }) {
  const src = imageUrl(post.coverImage, 'card')

  return (
    <a href={`/blog/${post.slug}`} className="group block">
      <div className="h-[235px] overflow-hidden rounded-t-btn bg-accent">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={post.coverImage?.alt ?? ''}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="min-h-[180px] rounded-b-btn bg-card p-5 pr-[23px] shadow-card">
        <p className="text-[16px] font-bold leading-[20px] text-brand">{post.title}</p>
        {formatDate(post.publishedAt) ? (
          <p className="rv-track text-[16px] leading-[20px] text-brand opacity-40">
            {formatDate(post.publishedAt)}
          </p>
        ) : null}
        {post.excerpt ? (
          <p className="rv-track mt-5 text-[16px] leading-[20px] text-brand">{post.excerpt}</p>
        ) : null}
      </div>
    </a>
  )
}

/** Shared page heading for the secondary pages. */
export function PageHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <Container className="pt-[90px]">
      <h1 className="max-w-[900px] text-[40px] font-medium leading-[1.12] text-brand sm:text-[60px] sm:leading-[67px]">
        {title}
      </h1>
      {lead ? (
        <p className="rv-track mt-5 max-w-[640px] text-[16px] leading-[22px] text-brand">{lead}</p>
      ) : null}
    </Container>
  )
}
