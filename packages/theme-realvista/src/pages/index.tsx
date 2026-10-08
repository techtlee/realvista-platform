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
} from '@makleri/core/format'
import type { ReactNode } from 'react'

import {
  Container,
  ContactSection,
  Footer,
  GhostButton,
  Header,
  MorePropertiesCard,
  OutlineButton,
  PageHeading,
  PostCard,
  PropertyCard,
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
const DEFAULT_SECTIONS = ['hero', 'featured', 'services', 'agent', 'stats', 'contact', 'blog']

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

  // `pages.home.sections` was validated by core and then ignored, because the
  // order was hard-coded in JSX. Unknown ids are skipped rather than throwing:
  // a Tier 3 client repo registers its own section ids, and a config naming one
  // this theme does not implement should drop it, not break the build.
  const order = site.pages.home?.sections ?? DEFAULT_SECTIONS

  const sections: Record<string, ReactNode> = {
    hero: (
      <section key="hero" className="relative isolate h-[700px] overflow-hidden">
        {heroSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-accent" />
        )}
        <div className="rv-hero-overlay absolute inset-0" />

        <Header settings={settings} overlay />

        <Container className="relative flex h-full flex-col justify-center">
          <h1 className="max-w-[689px] text-[40px] font-medium leading-[1.12] text-hero-ink sm:text-[60px] sm:leading-[67px]">
            {hero?.headline ?? 'Reality nejsou jen nemovitosti. Jsou to vaše další kroky.'}
          </h1>
          {hero?.subheadline ? (
            <p className="mt-10 max-w-[530px] text-[22px] font-medium leading-[1.2] text-hero-ink sm:text-[30px] sm:leading-[36px]">
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
              <p className="rv-track mt-4 text-[16px] leading-[20px] text-brand">
                Vyberte si svůj nový domov.
              </p>
            </div>
            <SolidButton href="/nemovitosti" className="min-w-[200px]">
              Zobrazit více
            </SolidButton>
          </div>

          {regions.length > 0 ? (
            <div className="-mx-5 mt-[50px] flex gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

    agent: agent ? (
      <section key="agent" id="o-makleri" className="rv-band-a relative mt-[150px] py-[55px]">
        <Container className="grid items-center gap-10 lg:grid-cols-[1fr_420px]">
          <div className="lg:pl-[110px]">
            <h2 className="max-w-[530px] text-[30px] font-medium leading-[36px] text-white">
              {settings?.about?.heading ?? 'Reality nejsou jen cihly. Jsou to vaše další životní kroky.'}
            </h2>
            <p className="rv-track mt-5 max-w-[640px] text-[16px] leading-[22px] text-white">
              {agent.jobTitle ? `${agent.name} — ${agent.jobTitle}.` : `${agent.name}.`}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {agent.phone ? (
                <GhostButton href={`tel:${agent.phone.replace(/\s/g, '')}`}>{agent.phone}</GhostButton>
              ) : null}
            </div>
          </div>
          {imageUrl(agent.photo, 'card') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(agent.photo, 'card')}
              alt={agent.name}
              className="mx-auto h-[459px] w-[420px] object-cover object-top"
            />
          ) : null}
        </Container>
      </section>
    ) : null,

    stats: settings?.stats?.length ? (
      <section key="stats" className="rv-band-b py-[72px]">
        <Container>
          <dl className="grid gap-12 text-center sm:grid-cols-3">
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

    blog:
      posts.length > 0 ? (
        <section key="blog" className="pb-[150px] pt-[150px]">
          <Container>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h2 className="text-[30px] font-medium leading-[36px] text-brand">Vědomosti a praxe</h2>
                <p className="rv-track mt-4 max-w-[520px] text-[16px] leading-[20px] text-brand">
                  Pravidelně sdílím své zkušenosti, hloubkové analýzy a praktické tipy.
                </p>
              </div>
              <SolidButton href="/blog" className="min-w-[200px]">
                Přejít na blog
              </SolidButton>
            </div>

            <div className="mt-[60px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {posts.slice(0, 3).map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          </Container>
        </section>
      ) : null,
  }

  return (
    <>
      {order.map((id) => sections[id] ?? null)}
      {/* The hero carries the header; any other opening section needs its own. */}
      {order[0] !== 'hero' ? <Header settings={settings} /> : null}
      <Footer settings={settings} />
    </>
  )
}

// ── listing index ────────────────────────────────────────────────────────────

export function RealvistaListingIndex({ settings, listings, totalListings }: ListingIndexPageProps) {
  return (
    <>
      <Header settings={settings} />
      <Container className="py-[90px]">
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
      <Footer settings={settings} />
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

export function RealvistaPropertyDetail({ settings, property, similar }: PropertyDetailPageProps) {
  const gallery = property.gallery ?? []
  const [main, ...rest] = gallery
  const agent = settings?.agent
  const perM2 = pricePerSquareMetre(property)

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
      <Header settings={settings} />

      <Container className="pt-[40px]">
        <nav className="flex flex-wrap items-center gap-2 text-[14px] leading-[18px] text-muted">
          <a href="/nemovitosti" className="hover:text-brand">
            Nemovitosti
          </a>
          <span>›</span>
          <span>{locationLabel(property)}</span>
          <span>›</span>
          <span className="font-medium text-brand">{propertyHeading(property)}</span>
        </nav>
      </Container>

      {gallery.length > 0 ? (
        <Container className="mt-[38px]">
          <div className="grid gap-5 lg:grid-cols-[640px_1fr]">
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
              <div className="grid gap-5 sm:grid-cols-2">
                {rest.slice(0, 4).map((g, i) => (
                  <div key={i} className="h-[150px] overflow-hidden rounded-btn bg-accent sm:h-[240px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(g.image, 'card')}
                      alt={g.alt ?? ''}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {gallery.length > 5 ? (
            <div className="mt-5 flex justify-end">
              <div className="flex h-[50px] w-full items-center justify-between rounded-btn bg-brand px-[30px] sm:w-[310px]">
                <span className="text-[16px] font-bold leading-[20px] text-white">Všechny fotky</span>
                <span className="text-[16px] font-bold leading-[20px] text-white opacity-60">
                  +{gallery.length - 5}
                </span>
              </div>
            </div>
          ) : null}
        </Container>
      ) : null}

      <Container className="mt-[50px]">
        <div className="flex flex-wrap items-start justify-between gap-6 rounded-btn bg-card px-5 py-[30px] shadow-card sm:px-[50px]">
          <div>
            <h1 className="max-w-[595px] text-[30px] font-medium leading-[36px] text-brand">
              {property.title}
            </h1>
            {specPills.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-3">
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
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">Popis nemovitosti</h2>
          <RichText
            value={property.description}
            className="mt-[50px] text-[16px] leading-[26px] text-brand"
          />

          <h2 className="mt-[100px] text-[30px] font-medium leading-[39px] text-brand">
            Parametry nemovitosti
          </h2>
          <dl className="mt-[25px] border-t border-accent">
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

        {agent ? (
          <aside className="h-fit rounded-btn bg-card p-[40px] shadow-card">
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

            <div className="mt-[40px] flex flex-wrap gap-3">
              <SolidButton href="#kontakt" className="flex-1">
                Domluvit prohlídku
              </SolidButton>
              {agent.phone ? (
                <OutlineButton href={`tel:${agent.phone.replace(/\s/g, '')}`} className="flex-1">
                  Zavolat makléři
                </OutlineButton>
              ) : null}
            </div>

            <div className="mt-[60px] flex flex-wrap gap-x-12 gap-y-3">
              {agent.phone ? (
                <p className="text-[16px] font-medium leading-[21px] text-brand">{agent.phone}</p>
              ) : null}
              {agent.email ? (
                <p className="text-[16px] font-medium leading-[21px] text-brand">{agent.email}</p>
              ) : null}
            </div>
          </aside>
        ) : null}
      </Container>

      {property.address?.city ? (
        <Container className="mt-[100px]">
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">Lokalita</h2>
          <p className="mt-[50px] max-w-[640px] text-[16px] leading-[24px] text-brand">
            {locationLabel(property)}
            {property.address.hideExactAddress
              ? '. Přesná adresa je k dispozici na vyžádání.'
              : '.'}
          </p>
        </Container>
      ) : null}

      {similar.length > 0 ? (
        <Container className="mt-[100px]">
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">Podobné nemovitosti</h2>
          <p className="mt-2 text-[16px] leading-[21px] text-muted">
            Prohlédněte si další exkluzivní nemovitosti v okolí.
          </p>
          <div className="mt-[50px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {similar.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </div>
        </Container>
      ) : null}

      <div className="mt-[150px]">
        {/* The enquiry arrives attached to the listing it was sent from. */}
        <ContactSection settings={settings} propertyId={property.id} />
      </div>

      <Footer settings={settings} />
    </>
  )
}

// ── blog ─────────────────────────────────────────────────────────────────────

export function RealvistaBlogIndex({ settings, posts }: BlogIndexPageProps) {
  return (
    <>
      <Header settings={settings} />
      <PageHeading
        title="Vědomosti a praxe"
        lead="Zkušenosti z trhu, hloubkové analýzy a praktické tipy k prodeji i pronájmu."
      />
      <Container className="pb-[150px] pt-[50px]">
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
      <Footer settings={settings} />
    </>
  )
}

export function RealvistaPostDetail({ settings, post, recent }: PostDetailPageProps) {
  const cover = imageUrl(post.coverImage, 'hero')
  const date = formatDate(post.publishedAt)

  return (
    <>
      <Header settings={settings} />

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

      <Container className="mt-[60px] max-w-[760px]">
        {post.excerpt ? (
          <p className="text-[22px] font-medium leading-[32px] text-brand">{post.excerpt}</p>
        ) : null}
        <RichText value={post.body} className="mt-[40px] text-[16px] leading-[26px] text-brand" />
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

      <div className="mt-[150px]">
        <ContactSection settings={settings} />
      </div>

      <Footer settings={settings} />
    </>
  )
}
