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

/*
 * Interface icons, copied path for path from the Figma components
 * (`arrow-right`, `phone`, `mail`). They are stroked in the brand colour there;
 * `currentColor` here, so each colourway gets its own without a second asset.
 */

function UiIcon({ size, className = '', children }: { size: number; className?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** 16px, the footer newsletter field. */
export const ArrowRightIcon = ({ className }: { className?: string }) => (
  <UiIcon size={16} className={className}>
    <path d="M3.3328 8H12.6672M8 12.6672L12.6672 8L8 3.3328" />
  </UiIcon>
)

/** 18px, the agent card on a listing. */
export const PhoneIcon = ({ className }: { className?: string }) => (
  <UiIcon size={18} className={className}>
    <path d="M10.3741 12.4263C10.529 12.4974 10.7035 12.5137 10.8689 12.4724C11.0343 12.431 11.1807 12.3346 11.2839 12.199L11.5502 11.8502C11.6899 11.6639 11.8711 11.5127 12.0794 11.4086C12.2877 11.3044 12.5174 11.2502 12.7503 11.2502H15.0005C15.3983 11.2502 15.7799 11.4082 16.0612 11.6896C16.3426 11.9709 16.5006 12.3524 16.5006 12.7503V15.0005C16.5006 15.3983 16.3426 15.7799 16.0612 16.0612C15.7799 16.3426 15.3983 16.5006 15.0005 16.5006C11.4198 16.5006 7.98572 15.0782 5.45377 12.5462C2.92183 10.0143 1.4994 6.58023 1.4994 2.99952C1.4994 2.60166 1.65745 2.2201 1.93877 1.93877C2.2201 1.65745 2.60166 1.4994 2.99952 1.4994H5.2497C5.64756 1.4994 6.02912 1.65745 6.31044 1.93877C6.59177 2.2201 6.74982 2.60166 6.74982 2.99952V5.2497C6.74982 5.48259 6.6956 5.71227 6.59145 5.92057C6.4873 6.12887 6.33608 6.31006 6.14977 6.4498L5.79874 6.71307C5.66104 6.81821 5.56399 6.96778 5.52406 7.13636C5.48414 7.30495 5.50381 7.48216 5.57973 7.63789C6.60482 9.71996 8.29076 11.4038 10.3741 12.4263Z" />
  </UiIcon>
)

/** 18px, the agent card on a listing. */
export const MailIcon = ({ className }: { className?: string }) => (
  <UiIcon size={18} className={className}>
    <path d="M16.5006 5.25038L9.75681 9.5452C9.52796 9.67809 9.26802 9.74809 9.00338 9.74809C8.73873 9.74809 8.47879 9.67809 8.24994 9.5452L1.4994 5.25038M16.5006 5.25038V4.50045C16.5006 3.67211 15.829 3.0006 15.0005 3.0006H2.99952C2.17103 3.0006 1.4994 3.67211 1.4994 4.50045V5.25038M16.5006 5.25038V13.4996C16.5006 14.3279 15.829 14.9994 15.0005 14.9994H2.99952C2.17103 14.9994 1.4994 14.3279 1.4994 13.4996V5.25038" />
  </UiIcon>
)
