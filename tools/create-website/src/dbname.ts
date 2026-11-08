import { createHash } from 'node:crypto'

/** Postgres identifiers are truncated silently at 63 bytes; we never let that happen. */
export const PG_MAX_IDENT = 63

/**
 * `backend_<slug_>_dev`, with `dbPrefix` in front (tests/evals use it to
 * namespace their DBs). Slugs are `[a-z0-9-]`, so the result is a plain
 * lowercase identifier that never needs quoting.
 *
 * Over 63 characters the slug part is cut to 40 characters (less when a
 * long test prefix needs the room) plus a 6-character hash of the full slug,
 * so two long slugs that share a prefix never collide.
 */
export function dbName(slug: string, prefix = ''): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`dbName: invalid slug "${slug}"`)
  if (prefix && !/^[a-z0-9_]+$/.test(prefix)) throw new Error(`dbName: invalid prefix "${prefix}"`)
  const s = slug.replaceAll('-', '_')
  const full = `${prefix}backend_${s}_dev`
  if (full.length <= PG_MAX_IDENT) return full
  const hash = createHash('sha256').update(slug).digest('hex').slice(0, 6)
  const budget = Math.min(40, PG_MAX_IDENT - `${prefix}backend__${hash}_dev`.length)
  if (budget < 8) throw new Error(`dbName: prefix "${prefix}" is too long`)
  return `${prefix}backend_${s.slice(0, budget).replace(/_+$/, '')}_${hash}_dev`
}
