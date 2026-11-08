/**
 * Real local Postgres, DBs `cwunit4_%` only, all dropped afterwards.
 * Skipped when no server answers on localhost:5432.
 */
import { afterAll, describe, expect, it } from 'vitest'

import { PgLocalPostgres, assertIdent } from '../../../src/pg/local.js'

const pg = new PgLocalPostgres({ postgres: { host: 'localhost', port: 5432 } })
const reachable = await pg.ping().then(
  () => true,
  () => false,
)
const name = `cwunit4_${process.pid}_${Date.now().toString(36)}`

afterAll(async () => {
  if (!reachable) return
  for (const d of await pg.listDatabases('cwunit4_')) await pg.dropDatabase(d)
})

describe.skipIf(!reachable)('LocalPostgres (real, cwunit4_%)', () => {
  it('create / exists / list / drop', async () => {
    expect(await pg.databaseExists(name)).toBe(false)
    await pg.createDatabase(name)
    expect(await pg.databaseExists(name)).toBe(true)
    expect(await pg.listDatabases('cwunit4_')).toContain(name)
    await pg.dropDatabase(name)
    expect(await pg.databaseExists(name)).toBe(false)
  })

  it('prefix listing escapes LIKE wildcards', async () => {
    await pg.createDatabase(`${name}_x`)
    expect(await pg.listDatabases('cwunit4%')).toEqual([])
    expect(await pg.listDatabases(`${name}_`)).toEqual([`${name}_x`])
  })
})

describe('LocalPostgres guards (no server needed)', () => {
  it('refuses unsafe and protected names', async () => {
    expect(() => assertIdent('x"; drop database y; --')).toThrow()
    await expect(pg.dropDatabase('realvista_crm_dev')).rejects.toThrow(/protected/)
    await expect(pg.createDatabase('postgres')).rejects.toThrow(/protected/)
  })
  it('url has no password unless configured', () => {
    expect(pg.url('cwunit4_a')).toMatch(/^postgres:\/\/[^:@]+@localhost:5432\/cwunit4_a$/)
  })
  it('unreachable server → POSTGRES_UNREACHABLE (exit 4)', async () => {
    const bad = new PgLocalPostgres({ postgres: { host: '127.0.0.1', port: 1 } })
    await expect(bad.ping()).rejects.toMatchObject({ code: 'POSTGRES_UNREACHABLE', exitCode: 4 })
  })
})
