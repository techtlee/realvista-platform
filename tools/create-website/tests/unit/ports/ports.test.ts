import { createServer, type Server } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ALWAYS_RESERVED_PORTS } from '../../../src/config.js'
import { dbName } from '../../../src/dbname.js'
import { PORTS_FILE, allocatePorts, isPortFree, readRegistry, releasePorts } from '../../../src/ports.js'
import { tmp } from '../../helpers/tmp.js'

const cfg = (clientsDir: string, site: [number, number] = [3110, 3199], backend: [number, number] = [3210, 3299]) => ({
  clientsDir,
  ports: { site, backend, reserved: [...ALWAYS_RESERVED_PORTS] },
})

describe('ports', () => {
  const servers: Server[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })

  it('allocates the lowest free ports and is stable per slug', async () => {
    const dir = tmp()
    const a = await allocatePorts({ cfg: cfg(dir), slug: 'alpha', isFree: async () => true })
    expect(a).toMatchObject({ site: 3110, backend: 3210, registered: true })
    const b = await allocatePorts({ cfg: cfg(dir), slug: 'beta', isFree: async () => true })
    expect(b).toMatchObject({ site: 3111, backend: 3211 })
    const again = await allocatePorts({ cfg: cfg(dir), slug: 'alpha', isFree: async () => false })
    expect(again).toMatchObject({ site: 3110, backend: 3210, registered: false })
    expect(JSON.parse(readFileSync(join(dir, PORTS_FILE), 'utf8')).slugs.alpha).toEqual({ site: 3110, backend: 3210 })
  })

  it('skips reserved and in-use ports', async () => {
    const dir = tmp()
    const busy = new Set([2999, 3001])
    const p = await allocatePorts({ cfg: cfg(dir, [2999, 3010], [3011, 3020]), slug: 'x', isFree: async (n) => !busy.has(n) })
    expect(p.site).toBe(3002) // 2999 busy, 3000/3001 reserved/busy
    expect(ALWAYS_RESERVED_PORTS).not.toContain(p.site)
    expect(p.backend).toBe(3011)
  })

  it('pre-registers novak-test at 3017/3027 and never gives those ports away', async () => {
    const dir = tmp()
    expect(readRegistry(dir).slugs['novak-test']).toEqual({ site: 3017, backend: 3027 })
    const p = await allocatePorts({ cfg: { clientsDir: dir, ports: { site: [3017, 3018], backend: [3027, 3028], reserved: [] } }, slug: 'y', isFree: async () => true })
    expect(p).toMatchObject({ site: 3018, backend: 3028 })
    releasePorts(dir, 'novak-test')
    expect(readRegistry(dir).slugs['novak-test']).toBeDefined()
  })

  it('refuses explicit reserved or foreign ports; NO_FREE_PORT when exhausted', async () => {
    const dir = tmp()
    await expect(allocatePorts({ cfg: cfg(dir), slug: 'z', want: { site: 3003 }, isFree: async () => true })).rejects.toMatchObject({ code: 'PORT_BUSY' })
    await expect(allocatePorts({ cfg: cfg(dir), slug: 'z', want: { site: 3017 }, isFree: async () => true })).rejects.toMatchObject({ code: 'PORT_BUSY' })
    await expect(allocatePorts({ cfg: cfg(dir), slug: 'z', isFree: async () => false })).rejects.toMatchObject({ code: 'NO_FREE_PORT' })
  })

  it('isPortFree sees a real listener', async () => {
    const srv = createServer()
    servers.push(srv)
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as { port: number }).port
    expect(await isPortFree(port)).toBe(false)
    srv.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(await isPortFree(port)).toBe(true)
  })
})

describe('dbName', () => {
  it('backend_<slug_>_dev with prefix', () => {
    expect(dbName('svoboda-reality')).toBe('backend_svoboda_reality_dev')
    expect(dbName('svoboda-reality', 'cwunit4_')).toBe('cwunit4_backend_svoboda_reality_dev')
  })
  it('caps at 63 chars with a hash, no collisions over 1,000 random long slugs', () => {
    const owner = new Map<string, string>()
    const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789-'
    const common = 'velmi-dlouhy-nazev-realitni-kancelare-'
    for (const prefix of ['', 'cwtest_ab12_']) {
      owner.clear()
      for (let i = 0; i < 1000; i++) {
        let s = common
        const n = 10 + Math.floor(Math.random() * 20)
        for (let j = 0; j < n; j++) s += alpha[Math.floor(Math.random() * 36)]
        s = s.replace(/-+$/, '') + 'x'
        const name = dbName(s, prefix)
        expect(name.length).toBeLessThanOrEqual(63)
        expect(name).toMatch(/^[a-z0-9_]+$/)
        expect(name.startsWith(prefix)).toBe(true)
        const prev = owner.get(name)
        if (prev !== undefined) expect(prev).toBe(s)
        owner.set(name, s)
      }
    }
    expect(dbName('a'.repeat(60))).toMatch(/^backend_a{40}_[0-9a-f]{6}_dev$/)
  })
  it('rejects junk', () => {
    expect(() => dbName('Bad Slug')).toThrow()
    expect(() => dbName('ok', 'Bad-Prefix')).toThrow()
  })
})
