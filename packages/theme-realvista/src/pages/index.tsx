import type {
  BlogIndexPageProps,
  HomePageProps,
  ListingIndexPageProps,
  PostDetailPageProps,
  PropertyDetailPageProps,
} from '@makleri/theme-kit'
import {
  conditionLabel,
  dispositionLabel,
  energyLabel,
  featureLabel,
  formatDate,
  formatPrice,
  imageUrl,
  locationLabel,
  ownershipLabel,
  pricePerSquareMetre,
  propertyHeading,
  regionCounts,
  richTextToParagraphs,
} from '@makleri/core/format'
import type { GalleryItem } from '@makleri/core/content'
import type { ReactNode } from 'react'

import { MailIcon, PhoneIcon } from '../icons.js'
import { manifest } from '../manifest.js'

import {
  Container,
  ContactSection,
  Footer,
  Header,
  MorePropertiesCard,
  MortgageCalculator,
  OutlineButton,
  PageHeading,
  PostCard,
  PropertyCard,
  PropertyMap,
  RegionChip,
  RichText,
  ServicesSection,
  SolidButton,
  SpecPill,
} from '../components/index.js'

/**
 * REALVISTA's five pages.
 *
 * Every one takes its props from `@makleri/theme-kit`, which assembles them
 * only out of `@makleri/core/content` types. That is the mechanism, not a
 * convention: this file cannot reach for a field the CMS does not have without
 * failing to compile, so a second layout cannot quietly require a schema change.
 */

// ── home ─────────────────────────────────────────────────────────────────────

/** The order the design draws, used when the client repo does not say. */
// Read from the manifest so the storefront picker and the theme cannot disagree.
const DEFAULT_SECTIONS = manifest.sections?.home ?? []

export function RealvistaHome({
  site,
  settings,
  featured,
  listings,
  totalListings,
  services,
  posts,
}: HomePageProps) {
  const hero = settings?.hero
  const agent = settings?.agent
  const heroSrc = imageUrl(hero?.backgroundImage, 'hero')
  const regions = regionCounts(listings)
  const grid = featured.length > 0 ? featured : listings.slice(0, 8)
  const remaining = Math.max(totalListings - grid.length, 0)
  // The band's paragraph is the realtor's own introduction: the about text,
  // else the agent bio, else name and title.
  const agentIntro =
    richTextToParagraphs(settings?.about?.body).join(' ') ||
    richTextToParagraphs(agent?.bio).join(' ') ||
    (agent ? (agent.jobTitle ? `${agent.name} — ${agent.jobTitle}.` : `${agent.name}.`) : '')

  // `pages.home.sections` was validated by core and then ignored, because the
  // order was hard-coded in JSX. Unknown ids are skipped rather than throwing:
  // a Tier 3 client repo registers its own section ids, and a config naming one
  // this theme does not implement should drop it, not break the build.
  const order = site.pages.home?.sections ?? DEFAULT_SECTIONS

  const sections: Record<string, ReactNode> = {
    hero: (
      // How the photo sits is the colourway's call, not the markup's: full
      // bleed under a wash (indigo, mono), or the right half of a gradient
      // band, as the cut-out portrait is drawn on crimson and clay. See
      // `.rv-hero` in theme.css.
      <section key="hero" className="rv-hero relative isolate h-[700px] overflow-hidden">
        {heroSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroSrc} alt="" className="rv-hero-photo absolute inset-y-0 h-full object-cover" />
        ) : (
          <div className="rv-hero-empty absolute inset-0" />
        )}
        <div className="rv-hero-overlay absolute inset-0" />

        {/* Top-anchored, not centred: the headline starts 188px down on the canvas. */}
        <Container className="relative pt-[120px] lg:pt-[188px]">
          <h1 className="max-w-[689px] text-[40px] font-medium leading-[1.12] text-hero-ink sm:text-[60px] sm:leading-[67px]">
            {hero?.headline ?? 'Reality nejsou jen nemovitosti. Jsou to vaše další kroky.'}
          </h1>
          {hero?.subheadline ? (
            <p className="mt-10 max-w-[530px] text-[22px] font-medium leading-[1.2] text-hero-ink sm:text-[30px] sm:leading-[36px] lg:mt-[110px]">
              {hero.subheadline}
            </p>
          ) : null}
        </Container>
      </section>
    ),

    featured: (
      <section key="featured" id="nabidka" className="pt-[150px]">
        <Container>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h2 className="text-[30px] font-medium leading-[36px] text-brand">
                Nabídka našich nemovitostí
              </h2>
              <p className="rv-track text-[16px] leading-[20px] text-brand">
                Vyberte si svůj nový domov.
              </p>
            </div>
            <SolidButton href="/nemovitosti" className="min-w-[200px]">
              Zobrazit více
            </SolidButton>
          </div>

          {regions.length > 0 ? (
            // The row scrolls sideways and fades out over its last 52px, as drawn.
            <div className="-mx-5 mt-[30px] flex gap-[10px] overflow-x-auto px-5 [mask-image:linear-gradient(to_right,#000_calc(100%-52px),transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
              {regions.map((r) => (
                <RegionChip
                  key={r.value}
                  label={r.label}
                  count={r.count}
                  href={`/nemovitosti?kraj=${r.value}`}
                />
              ))}
            </div>
          ) : null}

          {grid.length > 0 ? (
            <div className="mt-[30px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {grid.map((p) => (
                <PropertyCard key={p.id} property={p} />
              ))}
              {remaining > 0 ? <MorePropertiesCard count={remaining} href="/nemovitosti" /> : null}
            </div>
          ) : (
            <p className="rv-track mt-[50px] text-[16px] leading-[22px] text-muted">
              Právě připravujeme nové nabídky. Ozvěte se a dám vám vědět jako prvním.
            </p>
          )}
        </Container>
      </section>
    ),

    services: <ServicesSection key="services" services={services} />,

    // A 300px band, 200px below the listings. The 420×459 portrait stands on
    // its bottom edge and rises 159px out of it; it sits 110px in from the
    // right, mirroring the text's 110px indent on the left.
    agent: agent ? (
      <section key="agent" id="o-makleri" className="rv-band-a relative mt-[150px] lg:mt-[200px]">
        <Container>
          <div className="grid gap-10 pt-[55px] lg:min-h-[300px] lg:grid-cols-[1fr_420px] lg:gap-5 lg:pb-[55px] xl:px-[110px]">
          <div>
            <h2 className="max-w-[530px] text-[30px] font-medium leading-[36px] text-white">
              {settings?.about?.heading ?? 'Reality nejsou jen cihly. Jsou to vaše další životní kroky.'}
            </h2>
            <p className="rv-track mt-5 max-w-[640px] text-[16px] leading-[22px] text-white">
              {agentIntro}
            </p>
          </div>
          <div className="relative">
            {imageUrl(agent.photo, 'card') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(agent.photo, 'card')}
                alt={agent.name}
                className="mx-auto block h-[459px] w-full max-w-[420px] object-cover object-top lg:absolute lg:-bottom-[55px] lg:right-0 lg:w-[420px]"
              />
            ) : null}
          </div>
          </div>
        </Container>
      </section>
    ) : null,

    stats: settings?.stats?.length ? (
      <section key="stats" className="rv-band-b py-[72px]">
        <Container>
          {/* Column centres sit at 330 / 720 / 1118 on the canvas: a 1182px row, not the full 1300. */}
          <dl className="mx-auto grid max-w-[1182px] gap-12 text-center sm:grid-cols-3">
            {settings.stats.map((s, i) => (
              <div key={i}>
                <dt className="text-[60px] font-medium leading-[67px] text-white">{s.value}</dt>
                <dd className="mt-4 text-[30px] font-medium leading-[36px] text-white">{s.label}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>
    ) : null,

    contact: <ContactSection key="contact" settings={settings} />,

    // Off means no /blog route exists on the client site, so no teaser either.
    blog:
      site.features.blog && posts.length > 0 ? (
        // 192px under the contact form, 250px (50 + the footer's 200) above the footer.
        <section key="blog" className="pb-[50px] pt-[150px] lg:pt-[192px]">
          <Container>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h2 className="text-[30px] font-medium leading-[36px] text-brand">Vědomosti a praxe</h2>
                <p className="rv-track max-w-[520px] text-[16px] leading-[20px] text-brand">
                  Pravidelně sdílím své zkušenosti, hloubkové analýzy a praktické tipy.
                </p>
              </div>
              <SolidButton href="/blog" className="min-w-[200px]">
                Přejít na blog
              </SolidButton>
            </div>

            <div className="mt-[50px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {posts.slice(0, 3).map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          </Container>
        </section>
      ) : null,
  }

  // The header is rendered once, first, whatever the section order. It used to
  // live inside the hero, so moving the hero down moved the nav with it and a
  // second header was appended after the last section. It only takes the
  // transparent overlay look when the hero is directly underneath it.
  const heroFirst = order[0] === 'hero' && sections.hero != null

  // Every rendered section is marked with its id, so the rendered order can be
  // read back from the HTML (`[data-section]`) and compared with the config:
  // that is how /create-website's verify step and the kit's conformance suite
  // prove the site honours `pages.home.sections`. A `display: contents`
  // wrapper rather than an attribute on each section, because `services` and
  // `contact` are components with their own root, and the wrapper adds no box.
  // Sections that render nothing (no agent, no stats, blog off) get no marker.
  return (
    <>
      <Header settings={settings} site={site} overlay={heroFirst} />
      {order.map((id) => {
        const node = sections[id]
        return node == null ? null : (
          <div key={id} data-section={id} className="contents">
            {node}
          </div>
        )
      })}
      <Footer settings={settings} site={site} />
    </>
  )
}

// ── listing index ────────────────────────────────────────────────────────────

export function RealvistaListingIndex({ site, settings, listings, totalListings }: ListingIndexPageProps) {
  return (
    <>
      <Header settings={settings} site={site} />
      <Container className="pt-[90px]">
        <h1 className="text-[30px] font-medium leading-[36px] text-brand">Nabídka nemovitostí</h1>
        <p className="rv-track mt-4 text-[16px] leading-[20px] text-brand">
          {listingCount(totalListings)}
        </p>
        {listings.length > 0 ? (
          <div className="mt-[50px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {listings.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </div>
        ) : (
          <p className="rv-track mt-[50px] text-[16px] leading-[22px] text-muted">
            Momentálně nemám žádnou nemovitost v nabídce. Napište mi, co hledáte — ozvu se,
            jakmile se objeví něco vhodného.
          </p>
        )}
      </Container>
      <ContactSection settings={settings} />
      <Footer settings={settings} site={site} />
    </>
  )
}

/** Czech counts decline: 1 nemovitost, 2–4 nemovitosti, 5+ nemovitostí. */
function listingCount(n: number): string {
  if (n === 0) return 'Žádná nemovitost v nabídce'
  if (n === 1) return '1 nemovitost v nabídce'
  if (n < 5) return `${n} nemovitosti v nabídce`
  return `${n} nemovitostí v nabídce`
}

// ── property detail ──────────────────────────────────────────────────────────

export function RealvistaPropertyDetail({ site, settings, property, similar }: PropertyDetailPageProps) {
  const gallery = property.gallery ?? []
  const [main, ...rest] = gallery
  const agent = settings?.agent
  const perM2 = pricePerSquareMetre(property)
  // Sales with a stated price only: a payment derived from a monthly rent, or
  // from "Cena na vyžádání", would be a number with no meaning.
  const calculatorPrice =
    site.features.mortgageCalculator &&
    property.transactionType !== 'pronajem' &&
    !property.price?.onRequest &&
    property.price?.amount
      ? property.price.amount
      : undefined

  const params: [string, string | undefined][] = [
    ['Dispozice', dispositionLabel(property.disposition)],
    ['Užitná plocha', property.usableArea ? `${property.usableArea} m²` : undefined],
    ['Plocha pozemku', property.landArea ? `${property.landArea} m²` : undefined],
    [
      'Podlaží',
      property.floor != null
        ? property.totalFloors
          ? `${property.floor}. z ${property.totalFloors}`
          : `${property.floor}.`
        : undefined,
    ],
    ['Stav nemovitosti', conditionLabel(property.condition)],
    ['Vlastnictví', ownershipLabel(property.ownership)],
    ['Energetická náročnost', energyLabel(property.penb?.class)],
    ['Rok výstavby', property.yearBuilt ? String(property.yearBuilt) : undefined],
    [
      'Vybavení',
      property.features?.length ? property.features.map(featureLabel).join(', ') : undefined,
    ],
  ]

  const specPills = [
    property.usableArea ? `${property.usableArea} m²` : undefined,
    dispositionLabel(property.disposition)
      ? `Dispozice ${dispositionLabel(property.disposition)}`
      : undefined,
    property.features?.[0] ? featureLabel(property.features[0]) : undefined,
    ownershipLabel(property.ownership) ? `${ownershipLabel(property.ownership)} vlastnictví` : undefined,
  ].filter(Boolean) as string[]

  return (
    <>
      <Header settings={settings} site={site} />

      <Container className="pt-[40px]">
        <nav className="flex flex-wrap items-center gap-2 text-[14px] leading-[18px] text-muted">
          <a href="/nemovitosti" className="hover:text-brand">
            Nemovitosti
          </a>
          <span aria-hidden="true">&gt;</span>
          <span>{locationLabel(property)}</span>
          <span aria-hidden="true">&gt;</span>
          <span className="font-medium text-brand">{propertyHeading(property)}</span>
        </nav>
      </Container>

      {gallery.length > 0 ? (
        // Three columns, 640 / 310 / 310: the cover, two 240px photos stacked,
        // then one 430px photo with the "all photos" bar under it. Four photos
        // show; the bar counts the rest.
        <Container className="mt-5">
          <div className="grid gap-5 lg:grid-cols-[640fr_310fr_310fr]">
            <div className="h-[320px] overflow-hidden rounded-btn bg-accent sm:h-[500px]">
              {imageUrl(main?.image, 'hero') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(main?.image, 'hero')}
                  alt={main?.alt ?? property.title}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>

            {rest.length > 0 ? (
              <div className="grid grid-cols-2 gap-5 lg:grid-cols-1 lg:grid-rows-[240px_240px]">
                {rest.slice(0, 2).map((g, i) => (
                  <GalleryTile key={i} item={g} className="h-[150px] sm:h-[240px]" />
                ))}
              </div>
            ) : null}

            {rest.length > 2 || gallery.length > 4 ? (
              <div className="flex flex-col gap-5">
                {rest[2] ? <GalleryTile item={rest[2]} className="hidden lg:block lg:h-[430px]" /> : null}
                {gallery.length > 4 ? (
                  <div className="mt-auto flex h-[50px] w-full items-center justify-between rounded-btn bg-brand px-[30px]">
                    <span className="text-[16px] font-bold leading-[20px] text-white">Všechny fotky</span>
                    <span className="text-[16px] font-bold leading-[20px] text-white opacity-60">
                      +{gallery.length - 4}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </Container>
      ) : null}

      <Container className="mt-5">
        <div className="flex min-h-[150px] flex-wrap items-start justify-between gap-6 rounded-btn bg-card px-5 py-[30px] shadow-card sm:px-[50px]">
          <div>
            <h1 className="max-w-[595px] text-[30px] font-medium leading-[36px] text-brand">
              {property.title}
            </h1>
            {specPills.length > 0 ? (
              <div className="mt-[10px] flex flex-wrap gap-3">
                {specPills.map((s) => (
                  <SpecPill key={s}>{s}</SpecPill>
                ))}
              </div>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-[30px] font-bold leading-[39px] text-brand">{formatPrice(property)}</p>
            {perM2 ? <p className="text-[14px] leading-[18px] text-muted">{perM2}</p> : null}
          </div>
        </div>
      </Container>

      <Container className="mt-[100px] grid gap-[60px] lg:grid-cols-[640px_1fr] lg:gap-[130px]">
        <div>
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">O nemovitosti</h2>
          <RichText
            value={property.description}
            className="mt-[11px] text-[16px] leading-[26px] text-brand"
            paragraphClassName="mb-[26px] last:mb-0"
          />

          <h2 className="mt-[100px] text-[30px] font-medium leading-[39px] text-brand">
            Parametry nemovitosti
          </h2>
          <dl className="mt-[21px] border-t border-accent">
            {params
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-6 border-b border-accent py-[14px]">
                  <dt className="text-[16px] leading-[21px] text-muted">{k}</dt>
                  <dd className="text-right text-[16px] font-medium leading-[21px] text-brand">{v}</dd>
                </div>
              ))}
          </dl>

          {property.penb?.class === 'EXEMPT' && property.penb.exemptionReason ? (
            <p className="mt-4 text-[14px] leading-[18px] text-muted">
              Zákonná výjimka z povinnosti PENB: {property.penb.exemptionReason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-[30px]">
          {agent ? (
            <aside className="h-fit rounded-btn bg-card px-5 pb-10 pt-[30px] shadow-card sm:px-[40px] lg:min-h-[400px]">
              <p className="text-center text-[30px] font-medium leading-[39px] text-brand">
                Máte zájem o prohlídku?
              </p>

              <div className="mt-[18px] flex items-center gap-[30px]">
                {imageUrl(agent.photo, 'thumbnail') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(agent.photo, 'thumbnail')}
                    alt={agent.name}
                    className="h-20 w-20 shrink-0 rounded-btn object-cover"
                  />
                ) : null}
                <div>
                  <p className="text-[16px] font-bold leading-[21px] text-brand">{agent.name}</p>
                  {agent.jobTitle ? (
                    <p className="mt-1 text-[16px] leading-[21px] text-muted">{agent.jobTitle}</p>
                  ) : null}
                </div>
              </div>

              {/* Two 212px buttons 26px apart; each contact line centred under its button. */}
              <div className="mt-[40px] grid gap-3 sm:grid-cols-2 sm:gap-[26px]">
                <SolidButton href="#kontakt" className="px-4">
                  Domluvit prohlídku
                </SolidButton>
                {agent.phone ? (
                  <OutlineButton href={`tel:${agent.phone.replace(/\s/g, '')}`} className="px-4">
                    Zavolat makléři
                  </OutlineButton>
                ) : null}
              </div>

              <div className="mt-[50px] grid gap-3 sm:grid-cols-2 sm:gap-[26px]">
                {agent.phone ? (
                  <p className="flex items-center gap-3 text-[16px] font-medium leading-[21px] text-brand sm:justify-center">
                    <PhoneIcon className="shrink-0" />
                    {agent.phone}
                  </p>
                ) : null}
                {agent.email ? (
                  <p className="flex items-center gap-3 text-[16px] font-medium leading-[21px] text-brand sm:justify-center">
                    <MailIcon className="shrink-0" />
                    {agent.email}
                  </p>
                ) : null}
              </div>
            </aside>
          ) : null}
          {calculatorPrice ? <MortgageCalculator price={calculatorPrice} /> : null}
        </div>
      </Container>

      {property.address?.city ? (
        <Container className="mt-[100px] lg:mt-[115px]">
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">Lokalita</h2>
          <p className="mt-[11px] max-w-[640px] text-[16px] leading-[24px] text-brand">
            {locationLabel(property)}
            {property.address.hideExactAddress
              ? '. Přesná adresa je k dispozici na vyžádání.'
              : '.'}
          </p>
          {site.features.listingMap ? (
            <PropertyMap property={property} className="mt-[30px] max-w-[640px] lg:mt-[80px]" />
          ) : null}
        </Container>
      ) : null}

      {similar.length > 0 ? (
        <Container className="mt-[61px]">
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">Podobné nemovitosti</h2>
          <p className="text-[16px] leading-[21px] text-muted">
            Prohlédněte si další exkluzivní nemovitosti v okolí.
          </p>
          <div className="mt-[55px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {similar.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </div>
        </Container>
      ) : null}

      {/* The enquiry arrives attached to the listing it was sent from. */}
      <ContactSection settings={settings} propertyId={property.id} />

      <Footer settings={settings} site={site} />
    </>
  )
}

/** One photo of the listing gallery, cropped to whatever box the grid gives it. */
function GalleryTile({ item, className = '' }: { item: GalleryItem; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-btn bg-accent ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl(item.image, 'card')}
        alt={item.alt ?? ''}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    </div>
  )
}

// ── blog ─────────────────────────────────────────────────────────────────────

export function RealvistaBlogIndex({ site, settings, posts }: BlogIndexPageProps) {
  return (
    <>
      <Header settings={settings} site={site} />
      <PageHeading
        title="Vědomosti a praxe"
        lead="Zkušenosti z trhu, hloubkové analýzy a praktické tipy k prodeji i pronájmu."
      />
      <Container className="pt-[50px]">
        {posts.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        ) : (
          <p className="rv-track text-[16px] leading-[22px] text-muted">
            Zatím tu nic není. Připravuji první články.
          </p>
        )}
      </Container>
      <Footer settings={settings} site={site} />
    </>
  )
}

export function RealvistaPostDetail({ site, settings, post, recent }: PostDetailPageProps) {
  const cover = imageUrl(post.coverImage, 'hero')
  const date = formatDate(post.publishedAt)

  return (
    <>
      <Header settings={settings} site={site} />

      <Container className="pt-[40px]">
        <nav className="flex flex-wrap items-center gap-2 text-[14px] leading-[18px] text-muted">
          <a href="/blog" className="hover:text-brand">
            Blog
          </a>
          <span>›</span>
          <span className="font-medium text-brand">{post.title}</span>
        </nav>
      </Container>

      <Container className="pt-[40px]">
        <h1 className="max-w-[900px] text-[40px] font-medium leading-[1.12] text-brand sm:text-[60px] sm:leading-[67px]">
          {post.title}
        </h1>
        {date ? (
          <p className="rv-track mt-5 text-[16px] leading-[20px] text-muted">{date}</p>
        ) : null}
      </Container>

      {cover ? (
        <Container className="mt-[50px]">
          <div className="h-[320px] overflow-hidden rounded-btn bg-accent sm:h-[500px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover}
              alt={post.coverImage?.alt ?? ''}
              className="h-full w-full object-cover"
            />
          </div>
        </Container>
      ) : null}

      {/* A 760px reading column; on Container itself the max-width loses to Container's own. */}
      <Container className="mt-[60px]">
        <div className="mx-auto max-w-[760px]">
          {post.excerpt ? (
            <p className="text-[22px] font-medium leading-[32px] text-brand">{post.excerpt}</p>
          ) : null}
          <RichText value={post.body} className="mt-[40px] text-[16px] leading-[26px] text-brand" />
        </div>
      </Container>

      {recent.length > 0 ? (
        <Container className="mt-[150px]">
          <h2 className="text-[30px] font-medium leading-[36px] text-brand">Další články</h2>
          <div className="mt-[50px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {recent.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </Container>
      ) : null}

      <ContactSection settings={settings} />

      <Footer settings={settings} site={site} />
    </>
  )
}
