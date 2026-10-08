import type { ServiceIcon } from '@makleri/core/content'
import type { ServiceIconProps } from '@makleri/theme-kit'
import type { ComponentType, ReactNode } from 'react'

/**
 * The eight service icons, drawn as strokes on a 24px grid.
 *
 * All eight are mandatory. A theme shipping seven renders an empty box — and
 * only for the clients who happen to offer that one service, so it reaches a
 * paying customer long before it reaches us. The contract types this as a
 * complete `Record<ServiceIcon, …>`, which is why the set below cannot drift
 * from the CMS select without failing the build.
 *
 * `currentColor` throughout: the icon takes the colour of whatever band it sits
 * in, so the same glyph works on the page background and on the dark promo tile
 * without a second asset per colourway.
 */

function Glyph({ children, className = '' }: ServiceIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Prodej nemovitosti. */
const Home = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Glyph>
)

/** Pronájem a správa. */
const Key = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M11.2 11.2 21 21" />
    <path d="M17.5 17.5 19.5 15.5" />
    <path d="M14.8 14.8 16.8 12.8" />
  </Glyph>
)

/** Tržní odhad. */
const Chart = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <path d="M3 21h18" />
    <path d="M6 21V12" />
    <path d="M11 21V7" />
    <path d="M16 21v-6" />
    <path d="M21 21V4" />
  </Glyph>
)

/** Hypoteční poradenství. */
const Calculator = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <rect x="4.5" y="2.5" width="15" height="19" rx="2" />
    <path d="M8 6.5h8" />
    <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
    <path d="M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01" />
    <path d="M8.5 18h.01M12 18h.01M15.5 18h.01" />
  </Glyph>
)

/** Právní servis a úschova. */
const Document = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5Z" />
    <path d="M14 2.5v5h5" />
    <path d="M8.5 13h7" />
    <path d="M8.5 16.5h4.5" />
  </Glyph>
)

/** Výkup nemovitostí. */
const Shield = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.7 7.5 10 4.4-1.3 7.5-5.4 7.5-10v-6Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Glyph>
)

/** Výkup podílů, exekuce. */
const Handshake = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <path d="m2.5 12 3.5-3.5 4 1 2-1 2 1 4-1L21.5 12" />
    <path d="m7 13.5 3 3 1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5" />
    <path d="M6 8.5 8.5 6h7L18 8.5" />
  </Glyph>
)

/** Home staging a fotografie. */
const Camera = (p: ServiceIconProps) => (
  <Glyph {...p}>
    <path d="M3.5 8.5h3l1.5-2.5h8l1.5 2.5h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Glyph>
)

export const icons: Record<ServiceIcon, ComponentType<ServiceIconProps>> = {
  home: Home,
  key: Key,
  chart: Chart,
  calculator: Calculator,
  document: Document,
  shield: Shield,
  handshake: Handshake,
  camera: Camera,
}

/** Falls back to the generic glyph, so an unset icon is never an empty box. */
export function ServiceGlyph({ icon, className }: { icon?: ServiceIcon | null; className?: string }) {
  const Icon = (icon && icons[icon]) || icons.home
  return <Icon className={className} />
}
