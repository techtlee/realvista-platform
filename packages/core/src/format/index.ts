import type { Media, Property } from '../content/types.js'

/**
 * Czech real-estate presentation logic, shared by every theme.
 *
 * This is deliberately not in a theme. Prices, dispositions, energy classes and
 * kraje are facts about the Czech market, not design decisions — and a second
 * layout re-implementing them means two themes slowly disagreeing about what
 * "3+kk" or "Třída B" says to a buyer. A theme decides how a price *looks*;
 * this decides what it *reads*.
 *
 * Every label map falls through to the raw value rather than rendering nothing,
 * so a value added in the CMS before the label exists shows its slug instead of
 * a blank — visible and fixable, rather than silently missing.
 */

// ── media ────────────────────────────────────────────────────────────────────

export type ImageSize = 'thumbnail' | 'card' | 'hero' | 'full'

/**
 * URL for an uploaded image, falling back to the original when a derivative is
 * missing.
 *
 * Returned relative on purpose: media is tenant-scoped on the CMS, so each site
 * proxies it under the same path using its own key. Once R2 serves media the
 * adapter returns absolute URLs and those pass through untouched.
 */
export function imageUrl(media: Media | null | undefined, size: ImageSize = 'card') {
  if (!media) return undefined
  return media.sizes?.[size]?.url ?? media.url ?? undefined
}

// ── money ────────────────────────────────────────────────────────────────────

const czk = new Intl.NumberFormat('cs-CZ')

/** `8 490 000 Kč`, or `24 500 Kč / měsíc` for a rental. */
export function formatPrice(p: Property): string {
  const price = p.price
  if (!price || price.onRequest || price.amount == null) return 'Cena na vyžádání'

  const suffix =
    p.transactionType === 'pronajem' ? (price.period === 'rok' ? ' / rok' : ' / měsíc') : ''
  return `${czk.format(price.amount)} Kč${suffix}`
}

/**
 * `108 846 Kč / m²`.
 *
 * Undefined for rentals-by-period, price-on-request, and anything without a
 * usable area — a per-m² figure derived from a monthly rent would be nonsense.
 */
export function pricePerSquareMetre(p: Property): string | undefined {
  const amount = p.price?.amount
  const area = p.usableArea
  if (!amount || !area || p.price?.onRequest) return undefined
  if (p.transactionType === 'pronajem') return undefined
  return `${czk.format(Math.round(amount / area))} Kč / m²`
}

// ── enum labels ──────────────────────────────────────────────────────────────

const DISPOSITION_LABELS: Record<string, string> = {
  garsoniera: 'Garsoniéra', '1-kk': '1+kk', '1-1': '1+1', '2-kk': '2+kk', '2-1': '2+1',
  '3-kk': '3+kk', '3-1': '3+1', '4-kk': '4+kk', '4-1': '4+1', '5-kk': '5+kk', '5-1': '5+1',
  '6-a-vice': '6 a více', atypicky: 'Atypický',
}

const FEATURE_LABELS: Record<string, string> = {
  balkon: 'Balkon', lodzie: 'Lodžie', terasa: 'Terasa', sklep: 'Sklep', garaz: 'Garáž',
  parkovani: 'Parkování', vytah: 'Výtah', zahrada: 'Zahrada', bazen: 'Bazén', krb: 'Krb',
  klimatizace: 'Klimatizace', bezbarierovy: 'Bezbariérový', vybaveno: 'Vybaveno',
  'castecne-vybaveno': 'Částečně vybaveno', nevybaveno: 'Nevybaveno', internet: 'Internet',
  'mhd-v-dosahu': 'MHD v dosahu',
}

const OWNERSHIP_LABELS: Record<string, string> = {
  osobni: 'Osobní', druzstevni: 'Družstevní', statni: 'Státní / obecní',
}

const CONDITION_LABELS: Record<string, string> = {
  novostavba: 'Novostavba', 'velmi-dobry': 'Velmi dobrý', dobry: 'Dobrý',
  'po-rekonstrukci': 'Po kompletní rekonstrukci', 'pred-rekonstrukci': 'Před rekonstrukcí',
  spatny: 'Špatný', 'k-demolici': 'K demolici', 've-vystavbe': 'Ve výstavbě', projekt: 'Projekt',
}

const BUILDING_LABELS: Record<string, string> = {
  cihla: 'Cihlová', panel: 'Panelová', skeletova: 'Skeletová', drevostavba: 'Dřevostavba',
  montovana: 'Montovaná', smisena: 'Smíšená', ostatni: 'Ostatní',
}

const HEATING_LABELS: Record<string, string> = {
  'ustredni-dalkove': 'Ústřední dálkové', 'ustredni-plynove': 'Ústřední plynové',
  'ustredni-elektricke': 'Ústřední elektrické', 'lokalni-plynove': 'Lokální plynové',
  'tepelne-cerpadlo': 'Tepelné čerpadlo', 'kotel-tuha-paliva': 'Kotel na tuhá paliva',
  jine: 'Jiné',
}

const TRANSACTION_LABELS: Record<string, string> = {
  prodej: 'Prodej', pronajem: 'Pronájem', drazba: 'Dražba',
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  byt: 'Byt', dum: 'Dům', pozemek: 'Pozemek', komercni: 'Komerční objekt',
  garaz: 'Garáž', chata: 'Chata / rekreační objekt', ostatni: 'Ostatní',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rozpracovaný', active: 'Aktivní', reserved: 'Rezervováno',
  sold: 'Prodáno', rented: 'Pronajato',
}

/**
 * PENB classes, written the way the certificate does.
 *
 * Stating the class is required by zák. č. 406/2000 Sb., so these strings end up
 * in front of buyers and should not be abbreviated into something a certificate
 * would not say.
 */
const ENERGY_LABELS: Record<string, string> = {
  A: 'Třída A — Mimořádně úsporná', B: 'Třída B — Velmi úsporná', C: 'Třída C — Úsporná',
  D: 'Třída D — Méně úsporná', E: 'Třída E — Nehospodárná', F: 'Třída F — Velmi nehospodárná',
  G: 'Třída G — Mimořádně nehospodárná',
  EXEMPT: 'Zákonná výjimka', PENDING: 'Průkaz se zpracovává',
}

const lookup =
  (map: Record<string, string>) =>
  (v?: string | null): string | undefined =>
    v ? (map[v] ?? v) : undefined

export const dispositionLabel = lookup(DISPOSITION_LABELS)
export const ownershipLabel = lookup(OWNERSHIP_LABELS)
export const conditionLabel = lookup(CONDITION_LABELS)
export const buildingLabel = lookup(BUILDING_LABELS)
export const heatingLabel = lookup(HEATING_LABELS)
export const energyLabel = lookup(ENERGY_LABELS)
export const transactionLabel = lookup(TRANSACTION_LABELS)
export const propertyTypeLabel = lookup(PROPERTY_TYPE_LABELS)

/** Only the statuses worth showing a visitor — `draft` and `active` render nothing. */
export const statusBadge = (v?: string | null): string | undefined =>
  v && v !== 'draft' && v !== 'active' ? (STATUS_LABELS[v] ?? v) : undefined

export const statusLabel = lookup(STATUS_LABELS)

/** Features are always present when referenced, so this never returns undefined. */
export const featureLabel = (v: string): string => FEATURE_LABELS[v] ?? v

// ── place ────────────────────────────────────────────────────────────────────

/** The 14 kraje, in the order the CMS lists them. */
export const CZ_REGIONS: { value: string; label: string }[] = [
  { value: 'praha', label: 'Hlavní město Praha' },
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

export const regionLabel = lookup(
  Object.fromEntries(CZ_REGIONS.map((r) => [r.value, r.label])),
)

/**
 * Listing counts per region, for a filter UI.
 *
 * Returns only regions that actually have listings: a filter chip leading to an
 * empty result is a dead end for a visitor.
 */
export function regionCounts(properties: Property[]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of properties) {
    const r = p.address?.region
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  return CZ_REGIONS.filter((r) => counts.has(r.value)).map((r) => ({
    ...r,
    count: counts.get(r.value) as number,
  }))
}

/**
 * Address line, honouring the listing's privacy flag.
 *
 * When `hideExactAddress` is set the street is dropped entirely — a realtor sets
 * it because the owner does not want their home findable, so leaking it in a
 * card subtitle would defeat the point.
 */
export function locationLabel(p: Property): string {
  const a = p.address
  if (!a) return ''
  const parts = a.hideExactAddress ? [a.city, a.cityPart] : [a.street, a.cityPart, a.city]
  return parts.filter(Boolean).join(', ')
}

/** Card headline in the Czech convention: "3+kk Praha 7 Holešovice". */
export function cardTitle(p: Property): string {
  const d = dispositionLabel(p.disposition)
  const place = [p.address?.city, p.address?.cityPart].filter(Boolean).join(' ')
  return [d, place].filter(Boolean).join(' ') || p.title
}

/** `Byt 3+kk` — the breadcrumb form. */
export function propertyHeading(p: Property): string {
  const type = propertyTypeLabel(p.propertyType)
  const d = dispositionLabel(p.disposition)
  return [type, d].filter(Boolean).join(' ') || p.title
}

// ── dates ────────────────────────────────────────────────────────────────────

const czDate = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })

export function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : czDate.format(d)
}

// ── rich text ────────────────────────────────────────────────────────────────

interface LexicalNode {
  type?: string
  text?: string
  children?: LexicalNode[]
}

/**
 * Flattens a Lexical document to paragraphs of plain text.
 *
 * Payload stores rich text as a Lexical tree, and `description` is typed
 * `unknown` in the content contract precisely so themes do not couple to its
 * internals. Unknown node types fall through to their text rather than being
 * dropped, so a node type added later degrades to prose instead of blanking a
 * listing description.
 *
 * Returns data, not markup — each theme decides the element and spacing.
 */
export function richTextToParagraphs(value: unknown): string[] {
  const root = (value as { root?: LexicalNode } | null | undefined)?.root
  if (!root?.children) return []

  const text = (node: LexicalNode): string =>
    node.text ?? (node.children ?? []).map(text).join('')

  return root.children.map(text).filter((t) => t.trim().length > 0)
}
