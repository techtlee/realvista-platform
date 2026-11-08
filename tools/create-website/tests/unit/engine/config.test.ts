import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findConfig, isRealClientsDir, loadConfig } from '../../../src/config.js'
import { createTestHooks } from '../../../src/testHooks.js'
import type { Config } from '../../../src/types.js'
import { tmp } from '../../helpers/tmp.js'

function writeCfg(dir: string, o: Record<string, unknown> = {}) {
  writeFileSync(join(dir, 'create-website.config.json'), JSON.stringify({ clientsDir: './clients', platformRepo: './platform', cmsRepo: './cms', ...o }))
}

describe('config discovery', () => {
  it('walks up from the cwd and resolves paths against the config dir', () => {
    const root = tmp()
    writeCfg(root, { ports: { site: [4410, 4419], backend: [4420, 4429], reserved: [4415] } })
    const deep = join(root, 'a/b/c')
    mkdirSync(deep, { recursive: true })
    expect(findConfig(deep)).toBe(join(root, 'create-website.config.json'))
    const cfg = loadConfig({ cwd: deep, env: {} })
    expect(cfg.clientsDir).toBe(join(root, 'clients'))
    expect(cfg.cmsRef).toBe('main')
    expect(cfg.testMode).toBe(false)
    // the always-reserved ports are added whatever the config says
    expect(cfg.ports.reserved).toEqual(expect.arrayContaining([3000, 3001, 3003, 3004, 3017, 3027, 3029, 4415]))
  })

  it('--config and CW_* env override', () => {
    const root = tmp()
    writeCfg(root)
    const cfg = loadConfig({ cwd: '/', configPath: join(root, 'create-website.config.json'), env: { CW_DB_PREFIX: 'cwunit4_', CW_CRM_URL: 'http://localhost:4600' } })
    expect(cfg.dbPrefix).toBe('cwunit4_')
    expect(cfg.crm?.url).toBe('http://localhost:4600')
  })

  it('missing or invalid config → CONFIG_INVALID (exit 4)', () => {
    const root = tmp()
    expect(() => loadConfig({ cwd: root, env: {} })).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', exitCode: 4 }))
    writeCfg(root, { surprise: 1 })
    expect(() => loadConfig({ cwd: root, env: {} })).toThrow(/surprise/)
  })

  it('a testMode config pointing at the real Makleri/clients is refused', () => {
    const root = tmp()
    writeCfg(root, { clientsDir: '/Users/someone/Desktop/Techtle/Makleri/clients', testMode: true })
    expect(() => loadConfig({ cwd: root, env: {} })).toThrow(expect.objectContaining({ code: 'TEST_HOOKS_REFUSED' }))
  })

  it('isRealClientsDir: any casing of …/Makleri/clients, plus CW_REAL_CLIENTS_DIR', () => {
    expect(isRealClientsDir('/Users/x/desktop/techtle/makleri/clients', {})).toBe(true)
    expect(isRealClientsDir('/Users/x/Desktop/Techtle/Makleri/clients/', {})).toBe(true)
    expect(isRealClientsDir('/tmp/cw-e2e-1/clients', {})).toBe(false)
    expect(isRealClientsDir('/srv/clients', { CW_REAL_CLIENTS_DIR: '/srv/clients' })).toBe(true)
  })
})

describe('test hooks gate', () => {
  const testCfg = { testMode: true, clientsDir: '/tmp/cw-e2e-1/clients', configPath: '/tmp/cw-e2e-1/c.json' } as Config
  const prodCfg = { ...testCfg, testMode: false }
  const realCfg = { ...testCfg, clientsDir: '/Users/Josef.Vodicka/Desktop/Techtle/Makleri/clients' }

  it('off by default', () => {
    expect(createTestHooks(prodCfg, { env: {} })).toBeUndefined()
  })
  it('CW_TEST_HOOKS=1 under a non-test config is refused, not ignored', () => {
    expect(() => createTestHooks(prodCfg, { env: { CW_TEST_HOOKS: '1' } })).toThrow(expect.objectContaining({ code: 'TEST_HOOKS_REFUSED' }))
  })
  it('never with the real clients dir, even with testMode', () => {
    expect(() => createTestHooks(realCfg, { env: { CW_TEST_HOOKS: '1' } })).toThrow(/real clients dir/)
  })
  it('CW_FAIL_AT without CW_TEST_HOOKS is refused', () => {
    expect(() => createTestHooks(prodCfg, { env: { CW_FAIL_AT: 'site-build:before' } })).toThrow(/without CW_TEST_HOOKS/)
  })
  it('fail and crash points', () => {
    const exits: number[] = []
    const h = createTestHooks(testCfg, {
      env: { CW_TEST_HOOKS: '1', CW_FAIL_AT: 'site-key:after', CW_CRASH_AT: 'backend-copy:mid' },
      exit: ((c: number) => {
        exits.push(c)
      }) as (c: number) => never,
    })!
    expect(() => h.checkpoint('site-key', 'before')).not.toThrow()
    expect(() => h.checkpoint('site-key', 'after')).toThrow(/injected failure/)
    h.mid('site-copy')
    h.mid('backend-copy')
    expect(exits).toEqual([137])
  })
  it('rejects malformed points', () => {
    expect(() => createTestHooks(testCfg, { env: { CW_TEST_HOOKS: '1', CW_FAIL_AT: 'nope:before' } })).toThrow(/CW_FAIL_AT/)
    expect(() => createTestHooks(testCfg, { env: { CW_TEST_HOOKS: '1', CW_CRASH_AT: 'site-key:before' } })).toThrow(/CW_CRASH_AT/)
  })
})
