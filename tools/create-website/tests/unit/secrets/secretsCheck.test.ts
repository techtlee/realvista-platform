import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NodeExec } from '../../../src/exec.js'
import { Redactor } from '../../../src/redact.js'
import { FileSecretStore, knownSecrets, runSecretsCheck, scanForLeaks, secretParts } from '../../../src/secrets.js'
import { tmp } from '../../helpers/tmp.js'

const LOCAL_URL = 'postgres://localhost:5432/backend_svoboda_reality_dev'
const PW = 'Zx9q-very-long-db-password-77'
const PW_URL = `postgres://cw:${PW}@db.example:5432/backend_svoboda_reality_dev`

function client() {
  const clientsDir = tmp('cwunit4-sc-')
  const paths = {
    record: join(clientsDir, 'svoboda-reality'),
    backend: join(clientsDir, 'backend-svoboda-reality'),
    site: join(clientsDir, 'site-svoboda-reality'),
  }
  mkdirSync(join(paths.record, 'logs/cw-x'), { recursive: true })
  const store = new FileSecretStore(paths, new Redactor())
  const check = () => runSecretsCheck({ exec: new NodeExec({ redactor: new Redactor() }), store, paths, clientsDir })
  return { clientsDir, paths, store, check }
}

describe('secretParts', () => {
  it('a password-less URL holds nothing secret', () => {
    expect(secretParts(LOCAL_URL, 'backend/.env:DATABASE_URL')).toBeNull()
  })
  it('a URL with a password: whole URL, pieces from the password only', () => {
    expect(secretParts(PW_URL, 'k')).toEqual({ value: PW_URL, key: 'k', matchWhole: true, pieces: PW })
  })
  it('a plain secret: whole value and its pieces', () => {
    expect(secretParts('abcdefghijklmnop', 'k')).toMatchObject({ matchWhole: true, pieces: 'abcdefghijklmnop' })
    expect(secretParts('short', 'k')).toBeNull()
  })
})

describe('secrets-check (one implementation for the CLI and verify)', () => {
  it('a password-less DB URL and the DB name in logs, state and .env.example are NOT a leak', async () => {
    const c = client()
    await c.store.set({ file: 'backend/.env', key: 'DATABASE_URL' }, LOCAL_URL)
    await c.store.ensure('backend/.env', 'PAYLOAD_SECRET', () => c.store.generate())
    writeFileSync(join(c.paths.record, 'logs/cw-x/backend-migrate.log'), `connecting to ${LOCAL_URL}\ndb backend_svoboda_reality_dev ready\n`)
    writeFileSync(join(c.paths.record, 'create-website.state.json'), JSON.stringify({ db: { name: 'backend_svoboda_reality_dev', host: 'localhost', port: 5432 } }))
    const r = await c.check()
    expect(r).toMatchObject({ ok: true, hits: [] })
    expect(r.scannedFiles).toBe(2)
    expect(r.secretsKnown).toBe(1) // PAYLOAD_SECRET only
  })

  it('a URL with a password IS a leak, whole or as a 12-character piece of the password', async () => {
    const c = client()
    await c.store.set({ file: 'backend/.env', key: 'DATABASE_URL' }, PW_URL)
    writeFileSync(join(c.paths.record, 'logs/cw-x/a.log'), `url ${PW_URL}\n`)
    writeFileSync(join(c.paths.record, 'logs/cw-x/b.log'), `oops ${PW.slice(5, 17)}\n`)
    writeFileSync(join(c.paths.record, 'logs/cw-x/c.log'), 'db.example:5432/backend_svoboda_reality_dev\n')
    const r = await c.check()
    expect(r.ok).toBe(false)
    expect(r.hits).toEqual(
      expect.arrayContaining([
        { file: 'svoboda-reality/logs/cw-x/a.log', key: 'backend/.env:DATABASE_URL', kind: 'value' },
        { file: 'svoboda-reality/logs/cw-x/b.log', key: 'backend/.env:DATABASE_URL', kind: 'substring' },
      ]),
    )
    expect(r.hits).toHaveLength(2)
    expect(JSON.stringify(r)).not.toContain(PW.slice(5, 17))
  })

  it('finds a planted secret in a git-tracked file', async () => {
    const c = client()
    await c.store.ensure('site/.env.local', 'CMS_API_KEY', () => 'site-key-abcdefghijklmnop')
    const exec = new NodeExec({ redactor: new Redactor() })
    await exec.run(['git', 'init', '-q'], { cwd: c.paths.site })
    writeFileSync(join(c.paths.site, 'README.md'), 'key: site-key-abcdefghijklmnop\n')
    await exec.run(['git', 'add', 'README.md'], { cwd: c.paths.site })
    const r = await c.check()
    expect(r.hits).toEqual([{ file: 'site-svoboda-reality/README.md', key: 'site/.env.local:CMS_API_KEY', kind: 'value' }])
  })

  it('knownSecrets includes registered values and skips public keys', async () => {
    const c = client()
    await c.store.set({ file: 'backend/.env', key: 'TENANT_SLUG' }, 'svoboda-reality')
    c.store.register('minted-key-0123456789')
    expect(knownSecrets(c.store).map((k) => k.key)).toEqual(['(registered)'])
    expect(scanForLeaks([{ path: 'x', content: 'svoboda-reality' }], knownSecrets(c.store))).toEqual([])
  })
})
