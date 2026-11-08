import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** JSON with sorted keys, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    )
  }
  return v
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function sha256Json(value: unknown): string {
  return sha256(canonicalJson(value))
}

export function sha256File(path: string): string {
  return sha256(readFileSync(path))
}

/** `sha256:<hex>` over the canonical JSON of the parts that matter to a step. */
export function fingerprint(...parts: unknown[]): string {
  return `sha256:${sha256Json(parts)}`
}
