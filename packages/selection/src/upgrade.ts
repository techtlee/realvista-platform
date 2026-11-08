import { selectionV1Schema, type Selection } from './schema.js'

/**
 * Reads a stored selection of any version and returns the latest shape.
 *
 * A stored payload is never re-read under newer rules. Each version is parsed
 * by its own schema and then walked forward one explicit step at a time, so a
 * lead captured two years ago renders exactly as it was captured.
 *
 * When v2 lands:
 *   1. add `selectionV2Schema` in schema.ts and point `Selection` at it,
 *   2. add `2: (v1) => ({ ...v1, schemaVersion: 2, … })` to UPGRADES,
 *   3. leave the v1 schema exactly as it is.
 */
const UPGRADES: Record<number, (previous: unknown) => unknown> = {}

const LATEST = 1

export class UnknownSelectionVersionError extends Error {
  constructor(version: unknown) {
    super(`Unknown selection schemaVersion: ${JSON.stringify(version)}`)
    this.name = 'UnknownSelectionVersionError'
  }
}

export function readStoredSelection(raw: unknown): Selection {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion
  if (typeof version !== 'number' || version < 1 || version > LATEST) {
    throw new UnknownSelectionVersionError(version)
  }

  let current: unknown = selectionV1Schema.parse(raw)
  for (let v = 2; v <= LATEST; v++) {
    const step = UPGRADES[v]
    if (!step) throw new Error(`Missing upgrade step to selection v${v}`)
    current = step(current)
  }
  return current as Selection
}

/** Like {@link readStoredSelection} but returns null instead of throwing. */
export function tryReadStoredSelection(raw: unknown): Selection | null {
  try {
    return readStoredSelection(raw)
  } catch {
    return null
  }
}
