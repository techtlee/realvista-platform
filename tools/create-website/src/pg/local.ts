/**
 * LocalPostgres via `pg` (no psql on argv, no password on a command line).
 * Connects to the `postgres` maintenance DB to create/drop databases.
 * Names are validated as plain identifiers before being interpolated.
 */
import { existsSync, readFileSync } from 'node:fs'
import { userInfo } from 'node:os'

import pg from 'pg'

import { CwError, type Config, type LocalPostgres } from '../types.js'

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/

export function assertIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not a safe database name: "${name}"`)
  return name
}

/** Databases the engine must never create, drop or reuse. */
export const PROTECTED_DBS = new Set(['postgres', 'template0', 'template1', 'realvista_crm_dev', 'makleri_dev', 'cms_dev'])

export class PgLocalPostgres implements LocalPostgres {
  private readonly user: string
  private readonly password: string | undefined

  constructor(private readonly cfg: Pick<Config, 'postgres'>) {
    this.user = cfg.postgres.user ?? process.env.PGUSER ?? userInfo().username
    const pf = cfg.postgres.passwordFile
    this.password = pf && existsSync(pf) ? readFileSync(pf, 'utf8').trim() : process.env.PGPASSWORD
  }

  private async withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = new pg.Client({
      host: this.cfg.postgres.host,
      port: this.cfg.postgres.port,
      user: this.user,
      ...(this.password ? { password: this.password } : {}),
      database: 'postgres',
      connectionTimeoutMillis: 5000,
    })
    try {
      await c.connect()
    } catch (e) {
      throw new CwError('POSTGRES_UNREACHABLE', `Postgres at ${this.cfg.postgres.host}:${this.cfg.postgres.port} is unreachable: ${(e as Error).message}`, {
        hint: 'Start the local Postgres (brew services start postgresql) and retry.',
      })
    }
    try {
      return await fn(c)
    } finally {
      await c.end().catch(() => {})
    }
  }

  async ping(): Promise<void> {
    await this.withClient((c) => c.query('select 1'))
  }

  async databaseExists(name: string): Promise<boolean> {
    return this.withClient(async (c) => (await c.query('select 1 from pg_database where datname = $1', [name])).rowCount === 1)
  }

  async createDatabase(name: string): Promise<void> {
    assertIdent(name)
    if (PROTECTED_DBS.has(name)) throw new Error(`refusing to create protected database ${name}`)
    await this.withClient((c) => c.query(`create database "${name}"`))
  }

  async dropDatabase(name: string): Promise<void> {
    assertIdent(name)
    if (PROTECTED_DBS.has(name)) throw new Error(`refusing to drop protected database ${name}`)
    await this.withClient((c) => c.query(`drop database if exists "${name}" with (force)`))
  }

  async listDatabases(prefix: string): Promise<string[]> {
    return this.withClient(async (c) => {
      const like = prefix.replace(/[\\%_]/g, (m) => `\\${m}`) + '%'
      const r = await c.query<{ datname: string }>('select datname from pg_database where datname like $1 order by datname', [like])
      return r.rows.map((x) => x.datname)
    })
  }

  url(name: string): string {
    assertIdent(name)
    const auth = this.password ? `${encodeURIComponent(this.user)}:${encodeURIComponent(this.password)}@` : `${encodeURIComponent(this.user)}@`
    return `postgres://${auth}${this.cfg.postgres.host}:${this.cfg.postgres.port}/${name}`
  }
}
