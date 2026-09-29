import type { Post, Property, Service, SiteSettings } from '@makleri/core/content'

import {
  Container,
  ContactSection,
  Footer,
  GhostButton,
  Header,
  MorePropertiesCard,
  OutlineButton,
  PropertyCard,
  RegionChip,
  SolidButton,
  SpecPill,
  conditionLabel,
  dispositionLabel,
  energyLabel,
  featureLabel,
  formatPrice,
  imageUrl,
  locationLabel,
  ownershipLabel,
  pricePerSquareMetre,
} from '../components'

const REGIONS: { value: string; label: string }[] = [
  { value: 'praha', label: 'Praha' },
  { value: 'stredocesky', label: 'Středočeský kraj' },
  { value: 'jihocesky', label: 'Jihočeský kraj' },
  { value: 'plzensky', label: 'Plzeňský kraj' },
  { value: 'karlovarsky', label: 'Karlovarský kraj' },
  { value: 'ustecky', label: 'Ústecký kraj' },
  { value: 'liberecky', label: 'Liberecký kraj' },
  { value: 'kralovehradecky', label: 'Královéhradecký kraj' },
  { value: 'pardubicky', label: 'Pardubický kraj' },
  { value: 'vysocina', label: 'Kraj Vysočina' },
  { value: 'jihomoravsky', label: 'Jihomoravský kraj' },
  { value: 'olomoucky', label: 'Olomoucký kraj' },
  { value: 'zlinsky', label: 'Zlínský kraj' },
  { value: 'moravskoslezsky', label: 'Moravskoslezský kraj' },
]

/** Only regions that actually have listings — an empty filter chip is a dead end. */
function regionCounts(properties: Property[]) {
  const counts = new Map<string, number>()
  for (const p of properties) {
    const r = p.address?.region
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  return REGIONS.filter((r) => counts.has(r.value)).map((r) => ({
    ...r,
    count: counts.get(r.value) as number,
  }))
}

export interface HomeProps {
  settings: SiteSettings | null
  featured: Property[]
  all: Property[]
  services: Service[]
  posts?: Post[]
  totalListings?: number
}

export function RealvistaHome({ settings, featured, all, posts = [], totalListings }: HomeProps) {
  const hero = settings?.hero
  const agent = settings?.agent
  const heroSrc = imageUrl(hero?.backgroundImage, 'hero')
  const regions = regionCounts(all)
  const grid = featured.length > 0 ? featured : all.slice(0, 8)
  const remaining = Math.max((totalListings ?? all.length) - grid.length, 0)

  return (
    <>
      {/* Hero — 700px, photo with the diagonal wash from the export */}
      <section className="relative isolate h-[700px] overflow-hidden">
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

      {/* Listings */}
      <section id="nabidka" className="pt-[150px]">
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

          <div className="mt-[30px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {grid.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
            {remaining > 0 ? <MorePropertiesCard count={remaining} href="/nemovitosti" /> : null}
          </div>
        </Container>
      </section>

      {/* Agent band */}
      {agent ? (
        <section id="o-makleri" className="rv-band-a relative mt-[150px] py-[55px]">
          <Container className="grid items-center gap-10 lg:grid-cols-[1fr_420px]">
            <div className="lg:pl-[110px]">
              <h2 className="max-w-[530px] text-[30px] font-medium leading-[36px] text-white">
                Reality nejsou jen cihly. Jsou to vaše další životní kroky.
              </h2>
              <p className="rv-track mt-5 max-w-[640px] text-[16px] leading-[22px] text-white">
                {agent.jobTitle ? `${agent.name} — ${agent.jobTitle}. ` : `${agent.name}. `}
                {settings?.about?.heading ?? ''}
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
      ) : null}

      {/* Stats band */}
      {settings?.stats?.length ? (
        <section className="rv-band-b py-[72px]">
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
      ) : null}

      <ContactSection settings={settings} />

      {/* Blog */}
      {posts.length > 0 ? (
        <section className="pb-[150px]">
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

            <div className="mt-[106px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {posts.slice(0, 3).map((post) => (
                <a key={post.id} href={`/blog/${post.slug}`} className="group block">
                  <div className="h-[235px] overflow-hidden bg-accent">
                    {imageUrl(post.coverImage, 'card') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl(post.coverImage, 'card')}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                  <div className="min-h-[180px] bg-card p-[30px] shadow-card">
                    <p className="text-[16px] font-bold leading-[20px] text-brand">{post.title}</p>
                    {post.publishedAt ? (
                      <p className="rv-track mt-5 text-[16px] leading-[20px] text-brand opacity-40">
                        {new Date(post.publishedAt).toLocaleDateString('cs-CZ')}
                      </p>
                    ) : null}
                    {post.excerpt ? (
                      <p className="rv-track mt-5 text-[16px] leading-[20px] text-brand">{post.excerpt}</p>
                    ) : null}
                  </div>
                </a>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      <Footer settings={settings} />
    </>
  )
}

export interface PropertyDetailProps {
  settings: SiteSettings | null
  property: Property
  similar: Property[]
}

export function RealvistaPropertyDetail({ settings, property, similar }: PropertyDetailProps) {
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
    dispositionLabel(property.disposition) ? `Dispozice ${dispositionLabel(property.disposition)}` : undefined,
    property.features?.[0] ? featureLabel(property.features[0]) : undefined,
    ownershipLabel(property.ownership) ? `${ownershipLabel(property.ownership)} vlastnictví` : undefined,
  ].filter(Boolean) as string[]

  return (
    <>
      <Header settings={settings} />

      {/* Breadcrumbs */}
      <Container className="pt-[40px]">
        <nav className="flex flex-wrap items-center gap-2 text-[14px] leading-[18px] text-muted">
          <a href="/nemovitosti" className="hover:text-brand">Nemovitosti</a>
          <span>›</span>
          <span>{locationLabel(property)}</span>
          <span>›</span>
          <span className="font-medium text-brand">{cardHeading(property)}</span>
        </nav>
      </Container>

      {/* Gallery */}
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

      {/* Summary card */}
      <Container className="mt-[50px]">
        <div className="flex flex-wrap items-start justify-between gap-6 rounded-btn bg-card px-[50px] py-[30px] shadow-card">
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

      {/* Description + agent card */}
      <Container className="mt-[100px] grid gap-[130px] lg:grid-cols-[640px_1fr]">
        <div>
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">Popis nemovitosti</h2>
          <div className="mt-[50px] text-[16px] leading-[26px] text-brand">
            <RichText value={property.description} />
          </div>

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
              <SolidButton href="#kontakt" className="flex-1">Domluvit prohlídku</SolidButton>
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

      {/* Location */}
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

      {/* Similar */}
      {similar.length > 0 ? (
        <Container className="mt-[100px]">
          <h2 className="text-[30px] font-medium leading-[39px] text-brand">Podobné nemovitosti</h2>
          <p className="mt-2 text-[16px] leading-[21px] text-muted">
            Prohlédněte si další exkluzivní nemovitosti v okolí.
          </p>
          <div className="mt-[76px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {similar.map((p) => (
              <PropertyCard key={p.id} property={p} />
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

export interface ListingIndexProps {
  settings: SiteSettings | null
  properties: Property[]
}

export function RealvistaListingIndex({ settings, properties }: ListingIndexProps) {
  return (
    <>
      <Header settings={settings} />
      <Container className="py-[90px]">
        <h1 className="text-[30px] font-medium leading-[36px] text-brand">Nabídka nemovitostí</h1>
        <p className="rv-track mt-4 text-[16px] leading-[20px] text-brand">
          {properties.length} nemovitostí v nabídce
        </p>
        <div className="mt-[50px] grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => (
            <PropertyCard key={p.id} property={p} />
          ))}
        </div>
      </Container>
      <ContactSection settings={settings} />
      <Footer settings={settings} />
    </>
  )
}

function cardHeading(p: Property): string {
  const d = dispositionLabel(p.disposition)
  return d ? `Byt ${d}` : p.title
}

/**
 * Minimal Lexical renderer.
 *
 * Payload stores rich text as a Lexical tree. Only the node types the CMS can
 * currently produce are handled; anything unknown falls back to its text so a
 * new node type degrades to plain prose rather than blanking the description.
 */
function RichText({ value }: { value: unknown }) {
  const root = (value as { root?: { children?: unknown[] } } | null)?.root
  if (!root?.children) return null

  return (
    <>
      {root.children.map((node, i) => {
        const n = node as { type?: string; children?: { text?: string }[] }
        const text = (n.children ?? []).map((c) => c.text ?? '').join('')
        if (!text) return null
        return (
          <p key={i} className="mb-4 last:mb-0">
            {text}
          </p>
        )
      })}
    </>
  )
}
