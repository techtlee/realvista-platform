import type { Post, Property, Service, SiteSettings } from '@makleri/core/content'

import {
  Badge,
  Button,
  Container,
  EnergyBadge,
  Footer,
  Header,
  PropertyCard,
  Section,
  SectionHeading,
  dispositionLabel,
  formatPrice,
  imageUrl,
  locationLabel,
} from '../components'

export interface HomeProps {
  settings: SiteSettings | null
  featured: Property[]
  services: Service[]
  posts?: Post[]
}

export function RealvistaHome({ settings, featured, services }: HomeProps) {
  const hero = settings?.hero
  const agent = settings?.agent
  const heroSrc = imageUrl(hero?.backgroundImage, 'hero')

  return (
    <>
      <Header settings={settings} />

      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-brand-900">
        {heroSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        ) : null}
        <Container className="relative py-20 sm:py-28">
          <div className="max-w-2xl">
            <h1 className="font-display text-3xl leading-tight text-white sm:text-5xl">
              {hero?.headline ?? 'Reality nejsou jen nemovitosti.'}
            </h1>
            {hero?.subheadline ? (
              <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">{hero.subheadline}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href={hero?.ctaHref ?? '#kontakt'}>{hero?.ctaLabel ?? 'Nezávazná konzultace'}</Button>
              <a
                href="/nemovitosti"
                className="inline-flex items-center rounded-[var(--radius-card)] border border-white/30 px-5 py-3 text-sm text-white hover:bg-white/10"
              >
                Prohlédnout nabídku
              </a>
            </div>
          </div>
        </Container>
      </section>

      {/* Featured listings */}
      {featured.length > 0 ? (
        <Section id="nabidka">
          <SectionHeading sub="Vybrané nemovitosti z aktuální nabídky.">Nabídka nemovitostí</SectionHeading>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </div>
          <div className="mt-8">
            <Button href="/nemovitosti" variant="outline">
              Zobrazit všechny nemovitosti
            </Button>
          </div>
        </Section>
      ) : null}

      {/* Stats band */}
      {settings?.stats?.length ? (
        <section className="bg-brand-600 py-12">
          <Container>
            <dl className="grid gap-8 sm:grid-cols-3">
              {settings.stats.map((s, i) => (
                <div key={i}>
                  <dt className="font-display text-3xl text-on-brand sm:text-4xl">{s.value}</dt>
                  <dd className="mt-1 text-sm text-on-brand/75">{s.label}</dd>
                </div>
              ))}
            </dl>
          </Container>
        </section>
      ) : null}

      {/* Services */}
      {services.length > 0 ? (
        <Section id="sluzby" alt>
          <SectionHeading>Co pro vás zařídím</SectionHeading>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s) => (
              <div key={s.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h3 className="font-display text-base text-ink">{s.title}</h3>
                {s.description ? <p className="mt-2 text-sm text-ink-muted">{s.description}</p> : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Agent */}
      {agent ? (
        <Section id="o-mne">
          <div className="grid items-center gap-10 sm:grid-cols-[minmax(0,320px)_1fr]">
            {imageUrl(agent.photo, 'card') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(agent.photo, 'card')}
                alt={agent.name}
                className="aspect-[4/5] w-full rounded-[var(--radius-card)] object-cover"
              />
            ) : null}
            <div>
              <SectionHeading>{agent.name}</SectionHeading>
              {agent.jobTitle ? <p className="-mt-6 mb-4 text-ink-muted">{agent.jobTitle}</p> : null}
              <div className="flex flex-wrap gap-2">
                {agent.certifications?.map((c, i) => (c.label ? <Badge key={i}>{c.label}</Badge> : null))}
              </div>
              <div className="mt-6 space-y-1 text-sm text-ink-muted">
                {agent.phone ? <p>{agent.phone}</p> : null}
                {agent.email ? <p>{agent.email}</p> : null}
                {agent.licenceNumber ? (
                  <p className="pt-2 text-xs">
                    Osvědčení realitního zprostředkovatele č. {agent.licenceNumber}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      {/* Contact */}
      <Section id="kontakt" alt>
        <div className="grid gap-10 sm:grid-cols-2">
          <div>
            <SectionHeading sub="Ozvu se zpravidla do jednoho pracovního dne.">
              Máte zájem o mé služby?
            </SectionHeading>
            <div className="space-y-1 text-sm text-ink-muted">
              {settings?.contact?.phone ? <p>{settings.contact.phone}</p> : null}
              {settings?.contact?.email ? <p>{settings.contact.email}</p> : null}
              {settings?.contact?.officeHours ? (
                <p className="pt-2 whitespace-pre-line">{settings.contact.officeHours}</p>
              ) : null}
            </div>
          </div>
          <ContactForm consentText={settings?.legal?.gdprConsentText} />
        </div>
      </Section>

      <Footer settings={settings} />
    </>
  )
}

function ContactForm({ consentText }: { consentText?: string | null }) {
  const field =
    'w-full rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-500'

  return (
    <form method="post" action="/api/poptavka" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="name" required placeholder="Jméno a příjmení" className={field} />
        <input name="phone" placeholder="Telefon" className={field} />
      </div>
      <input name="email" type="email" placeholder="E-mail" className={field} />
      <textarea name="message" rows={4} placeholder="Zpráva" className={field} />
      <label className="flex items-start gap-2 text-xs text-ink-muted">
        <input type="checkbox" name="consent" required className="mt-0.5" />
        <span>{consentText ?? 'Souhlasím se zpracováním osobních údajů.'}</span>
      </label>
      <button
        type="submit"
        className="w-full rounded-[var(--radius-card)] bg-brand-600 px-5 py-3 text-sm font-medium text-on-brand hover:bg-brand-700"
      >
        Odeslat poptávku
      </button>
    </form>
  )
}

export interface PropertyDetailProps {
  settings: SiteSettings | null
  property: Property
  similar: Property[]
}

export function RealvistaPropertyDetail({ settings, property, similar }: PropertyDetailProps) {
  const gallery = property.gallery ?? []
  const cover = gallery[0]?.image
  const rest = gallery.slice(1, 5)

  const params: [string, string | undefined][] = [
    ['Dispozice', dispositionLabel(property.disposition)],
    ['Užitná plocha', property.usableArea ? `${property.usableArea} m²` : undefined],
    ['Plocha pozemku', property.landArea ? `${property.landArea} m²` : undefined],
    ['Podlaží', property.floor != null ? String(property.floor) : undefined],
    ['Rok výstavby', property.yearBuilt ? String(property.yearBuilt) : undefined],
    ['Vlastnictví', property.ownership ?? undefined],
    ['Stav', property.condition ?? undefined],
    ['Energetická třída', property.penb?.class ?? undefined],
  ]

  return (
    <>
      <Header settings={settings} />

      <Container className="py-6">
        <a href="/nemovitosti" className="text-sm text-ink-muted hover:text-ink">
          ← Zpět na nabídku
        </a>
      </Container>

      {/* Gallery */}
      <Container className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-4 lg:col-span-2 lg:row-span-2">
          {imageUrl(cover, 'hero') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(cover, 'hero')}
              alt={cover?.alt ?? property.title}
              className="aspect-[3/2] w-full rounded-[var(--radius-card)] object-cover"
            />
          ) : null}
        </div>
        {rest.map((g, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={imageUrl(g.image, 'card')}
            alt={g.alt ?? ''}
            className="aspect-[3/2] w-full rounded-[var(--radius-card)] object-cover"
          />
        ))}
      </Container>

      <Container className="grid gap-10 py-10 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="font-display text-2xl leading-tight text-ink sm:text-3xl">{property.title}</h1>
          <p className="mt-2 text-ink-muted">{locationLabel(property)}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {dispositionLabel(property.disposition) ? (
              <Badge>{dispositionLabel(property.disposition)}</Badge>
            ) : null}
            {property.usableArea ? <Badge>{property.usableArea} m²</Badge> : null}
            <EnergyBadge value={property.penb?.class} />
          </div>

          <p className="mt-6 font-display text-3xl text-brand-700">{formatPrice(property)}</p>

          <h2 className="mt-10 font-display text-xl text-ink">Parametry nemovitosti</h2>
          <dl className="mt-4 divide-y divide-line border-y border-line">
            {params
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5 text-sm">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
          </dl>

          {property.penb?.class === 'EXEMPT' && property.penb.exemptionReason ? (
            <p className="mt-3 text-xs text-ink-muted">
              Zákonná výjimka z povinnosti PENB: {property.penb.exemptionReason}
            </p>
          ) : null}
        </div>

        {/* Agent card */}
        <aside className="h-fit rounded-[var(--radius-card)] border border-line bg-surface-alt p-5">
          <p className="font-display text-base text-ink">Máte zájem o prohlídku?</p>
          {settings?.agent ? (
            <div className="mt-4 flex items-center gap-3">
              {imageUrl(settings.agent.photo, 'thumbnail') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(settings.agent.photo, 'thumbnail')}
                  alt={settings.agent.name}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : null}
              <div>
                <p className="text-sm font-medium text-ink">{settings.agent.name}</p>
                <p className="text-xs text-ink-muted">{settings.agent.jobTitle}</p>
              </div>
            </div>
          ) : null}
          <div className="mt-5 space-y-2">
            {settings?.agent?.phone ? (
              <Button href={`tel:${settings.agent.phone.replace(/\s/g, '')}`}>
                {settings.agent.phone}
              </Button>
            ) : null}
            {settings?.agent?.email ? (
              <Button href={`mailto:${settings.agent.email}`} variant="outline">
                Napsat e-mail
              </Button>
            ) : null}
          </div>
        </aside>
      </Container>

      {similar.length > 0 ? (
        <Section alt>
          <SectionHeading>Podobné nemovitosti</SectionHeading>
          <div className="grid gap-5 sm:grid-cols-3">
            {similar.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </div>
        </Section>
      ) : null}

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
      <Section>
        <SectionHeading sub={`${properties.length} nemovitostí v nabídce`}>
          Nabídka nemovitostí
        </SectionHeading>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => (
            <PropertyCard key={p.id} property={p} />
          ))}
        </div>
      </Section>
      <Footer settings={settings} />
    </>
  )
}
