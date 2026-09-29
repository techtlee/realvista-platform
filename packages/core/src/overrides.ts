import type { ComponentType } from 'react'

/**
 * The customisation escape hatch.
 *
 * A static, typed map — deliberately not a React context registry. Themes
 * render as React Server Components, where context does not exist and does not
 * cross the server/client boundary; a context-based registry would force every
 * themed component to become a client component, which would destroy server
 * rendering of listing pages. For a realtor, search visibility on listings is
 * the product, so that trade is not available.
 *
 * Because the map is static and typed, it is also machine-readable: the fleet
 * scanner parses `overrides/index.ts` with the TypeScript compiler API to
 * report exactly which slots each client repo overrides. That feeds the slot
 * heat map — when three clients override the same slot, it should become a
 * config option instead.
 */

export type SlotRecord = Record<string, ComponentType<never>>

export interface CustomSectionProps {
  /** Resolved site configuration. */
  site: unknown
  /** Whatever the page passes for this section. */
  data?: unknown
}

export interface OverrideMap<S extends SlotRecord = SlotRecord> {
  /** Replace a named component the theme declares in its `slots.ts`. */
  slots?: Partial<S>
  /** Register a bespoke section, referenced by id from `site.config.ts`. */
  sections?: Record<string, ComponentType<CustomSectionProps>>
}

/**
 * Identity function that exists purely to pin the type parameter, so a client
 * repo gets autocomplete and a compile error when a theme's slot contract
 * changes under it.
 */
export function defineOverrides<S extends SlotRecord>(map: OverrideMap<S>): OverrideMap<S> {
  return map
}

/**
 * Merges a theme's default components with a client's overrides.
 *
 * Resolved once at the page root and threaded down as a prop, keeping the
 * render tree server-side.
 */
export function resolveSlots<S extends SlotRecord>(defaults: S, overrides?: Partial<S>): S {
  if (!overrides) return defaults
  return { ...defaults, ...overrides }
}
