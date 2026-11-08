import type { Property } from '@makleri/core/content'
import { locationLabel } from '@makleri/core/format'

/**
 * The listing's location as an OpenStreetMap embed.
 *
 * An iframe rather than a map library: no dependency, no JavaScript of ours,
 * no API key, and it stays a Server Component.
 *
 * Privacy first. When the realtor sets `hideExactAddress` the owner does not
 * want the home findable, so the map shows an approximate area with no pin,
 * centred on a point snapped to a ~5 km grid — the exact coordinates never
 * reach the markup. Without coordinates at all it falls back to the kraj, and
 * without a kraj it renders nothing.
 */

/** Rough centres of the 14 kraje, for listings entered without coordinates. */
const REGION_CENTRES: Record<string, [lat: number, lng: number]> = {
  praha: [50.08, 14.44],
  stredocesky: [49.9, 14.6],
  jihocesky: [49.05, 14.45],
  plzensky: [49.55, 13.3],
  karlovarsky: [50.2, 12.85],
  ustecky: [50.5, 13.85],
  liberecky: [50.75, 15.05],
  kralovehradecky: [50.35, 15.8],
  pardubicky: [49.9, 16.1],
  vysocina: [49.4, 15.6],
  jihomoravsky: [49.05, 16.6],
  olomoucky: [49.75, 17.1],
  zlinsky: [49.2, 17.65],
  moravskoslezsky: [49.8, 18.1],
}

/** Grid step for a hidden address: ~5.5 km north–south, ~3.6 km east–west. */
const HIDDEN_GRID = 0.05

const snap = (v: number) => Math.round(v / HIDDEN_GRID) * HIDDEN_GRID

export interface MapView {
  lat: number
  lng: number
  /** Half-height of the bounding box, in degrees of latitude. */
  span: number
  /** False when the view is an approximate area: no pin is drawn. */
  pin: boolean
}

/** Where the map looks, or null when there is nothing honest to show. */
export function mapView(property: Property): MapView | null {
  const a = property.address
  if (!a) return null

  const hasCoords = typeof a.lat === 'number' && typeof a.lng === 'number'

  if (hasCoords && !a.hideExactAddress) {
    return { lat: a.lat as number, lng: a.lng as number, span: 0.004, pin: true }
  }
  if (hasCoords) {
    return { lat: snap(a.lat as number), lng: snap(a.lng as number), span: 0.04, pin: false }
  }
  const centre = a.region ? REGION_CENTRES[a.region] : undefined
  if (centre) return { lat: centre[0], lng: centre[1], span: 0.35, pin: false }
  return null
}

/** The embed URL. Exported so the privacy rule can be tested on the URL itself. */
export function osmEmbedUrl(view: MapView): string {
  const digits = view.pin ? 5 : 2
  const f = (v: number) => v.toFixed(digits)
  // Longitude degrees are shorter here (~50° N), so widen the box to keep it roughly square.
  const lngSpan = view.span * 1.55
  const bbox = [view.lng - lngSpan, view.lat - view.span, view.lng + lngSpan, view.lat + view.span]
    .map(f)
    .join(',')
  const marker = view.pin ? `&marker=${f(view.lat)},${f(view.lng)}` : ''
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${marker}`
}

function osmLinkUrl(view: MapView): string {
  const zoom = view.pin ? 16 : view.span < 0.1 ? 12 : 9
  const digits = view.pin ? 5 : 2
  const lat = view.lat.toFixed(digits)
  const lng = view.lng.toFixed(digits)
  const marker = view.pin ? `mlat=${lat}&mlon=${lng}` : ''
  return `https://www.openstreetmap.org/?${marker}#map=${zoom}/${lat}/${lng}`
}

export function PropertyMap({ property, className = '' }: { property: Property; className?: string }) {
  const view = mapView(property)
  if (!view) return null

  const place = locationLabel(property)

  return (
    <figure data-rv-map="" className={className}>
      <div className="h-[300px] overflow-hidden rounded-btn bg-accent sm:h-[400px]">
        <iframe
          src={osmEmbedUrl(view)}
          title={place ? `Mapa — ${place}` : 'Mapa'}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="h-full w-full border-0"
        />
      </div>
      <figcaption className="mt-3 flex flex-wrap justify-between gap-3 text-[14px] leading-[18px] text-muted">
        <span>{view.pin ? place : 'Zobrazena přibližná oblast.'}</span>
        <a href={osmLinkUrl(view)} target="_blank" rel="noopener noreferrer" className="hover:text-brand">
          Zobrazit větší mapu
        </a>
      </figcaption>
    </figure>
  )
}
