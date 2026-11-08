/**
 * Read-only queries against the client's backend database, so seed steps can
 * probe the world ("does the tenant / the realtor's user exist?") instead of
 * trusting the state file. The connection string comes from the secret store
 * in-process and is never logged.
 */
import pg from 'pg'

import type { Ctx } from '../types.js'

export type BackendQuery = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

/** Tests replace this; the default opens one short-lived pg client per call. */
export let backendQueryFactory = (ctx: Ctx): BackendQuery => async (sql, params = []) => {
  const url = await ctx.secrets.get({ file: 'backend/.env', key: 'DATABASE_URL' })
  if (!url) return []
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    const r = await client.query(sql, params)
    return r.rows as Record<string, unknown>[]
  } finally {
    await client.end().catch(() => undefined)
  }
}

export function setBackendQueryFactory(f: (ctx: Ctx) => BackendQuery): void {
  backendQueryFactory = f
}

/** Count rows, treating a missing table/DB as 0 (fresh database before migrate). */
export async function countRows(ctx: Ctx, sql: string, params: unknown[]): Promise<number> {
  try {
    const rows = await backendQueryFactory(ctx)(sql, params)
    return Number(rows[0]?.n ?? 0)
  } catch {
    return 0
  }
}

export async function tenantIdBySlug(ctx: Ctx, slug: string): Promise<number | null> {
  try {
    const rows = await backendQueryFactory(ctx)('select id from tenants where slug = $1 limit 1', [slug])
    return rows[0] ? Number(rows[0].id) : null
  } catch {
    return null
  }
}

export async function userExists(ctx: Ctx, email: string): Promise<boolean> {
  return (await countRows(ctx, 'select count(*)::int as n from users where lower(email) = lower($1)', [email])) > 0
}
