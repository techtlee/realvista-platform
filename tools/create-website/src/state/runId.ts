import { randomBytes } from 'node:crypto'

/** `cw-20261108T120301Z-7f3a`: sortable, unique enough per machine. */
export function newRunId(now = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `cw-${ts}-${randomBytes(2).toString('hex')}`
}

export const RUN_ID_RE = /^cw-\d{8}T\d{6}Z-[0-9a-f]{4}$/
