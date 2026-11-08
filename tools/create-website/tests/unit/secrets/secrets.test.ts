import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NodeExec } from '../../../src/exec.js'
import { REDACTED, Redactor, redact } from '../../../src/redact.js'
import { FileSecretStore, classifyKey, dotenvToRecord } from '../../../src/secrets.js'
import { tmp } from '../../helpers/tmp.js'

function store() {
  const root = tmp()
  const paths = { backend: join(root, 'backend-svoboda-reality'), site: join(root, 'site-svoboda-reality') }
  const warnings: string[] = []
  const s = new FileSecretStore(paths, new Redactor(), (m) => warnings.push(m))
  return { root, paths, s, warnings }
}

describe('SecretStore', () => {
  it('ensure never overwrites an existing value', async () => {
    const { s } = store()
    expect(await s.ensure('backend/.env', 'PAYLOAD_SECRET', () => 'first-value-123456')).toEqual({ created: true })
    expect(await s.ensure('backend/.env', 'PAYLOAD_SECRET', () => 'second-value-123456')).toEqual({ created: false })
    expect(await s.get({ file: 'backend/.env', key: 'PAYLOAD_SECRET' })).toBe('first-value-123456')
  })

  it('fills a missing key without touching existing ones, keeping comments', async () => {
    const { s } = store()
    await s.ensure('backend/.env', 'A_SECRET', () => 'aaaaaaaaaaaa')
    const p = s.pathOf('backend/.env')
    writeFileSync(p, '# keep me\n' + readFileSync(p, 'utf8'))
    await s.ensure('backend/.env', 'B_SECRET', () => 'bbbbbbbbbbbb')
    expect(readFileSync(p, 'utf8')).toBe('# keep me\nA_SECRET=aaaaaaaaaaaa\nB_SECRET=bbbbbbbbbbbb\n')
  })

  it('writes 0600 atomically, leaving no temp files', async () => {
    const { s, paths } = store()
    await s.ensure('backend/.admin-credentials.local', 'CLIENT_PASSWORD', () => s.generate())
    await s.set({ file: 'site/.env.local', key: 'CMS_API_KEY' }, 'key-value-abcdefgh')
    for (const f of ['backend/.admin-credentials.local', 'site/.env.local'] as const) {
      expect(statSync(s.pathOf(f)).mode & 0o777).toBe(0o600)
    }
    expect(readdirSync(paths.backend).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('generates url-safe random values in-process', () => {
    const { s } = store()
    const a = s.generate()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(s.generate()).not.toBe(a)
  })

  it('classifies keys: secrets, public values, unknown', () => {
    expect(classifyKey('PAYLOAD_SECRET')).toBe('secret')
    expect(classifyKey('DATABASE_URL')).toBe('secret')
    expect(classifyKey('SOME_TOKEN')).toBe('secret')
    expect(classifyKey('TENANT_SLUG')).toBe('public')
    expect(classifyKey('CLIENT_EMAIL')).toBe('public')
    expect(classifyKey('PORT')).toBe('public')
    expect(classifyKey('CW_CRM_API_KEY')).toBe('secret')
    expect(classifyKey('CW_CRM_EMAIL')).toBe('secret')
    expect(classifyKey('FAVOURITE_COLOUR')).toBe('unknown')
  })

  it('registers only secret-classified values; unknown keys in secret files are secret (with a warning)', async () => {
    const { s, warnings } = store()
    await s.set({ file: 'backend/.env', key: 'TENANT_SLUG' }, 'svoboda-reality')
    await s.set({ file: 'backend/.env', key: 'PLATFORM_SUBDOMAIN_BASE' }, 'realvista.cz')
    await s.set({ file: 'backend/.env', key: 'DATABASE_URL' }, 'postgres://localhost:5432/backend_svoboda_reality_dev')
    await s.set({ file: 'backend/.env', key: 'MYSTERY_VALUE' }, 'mystery-value-xyz')
    expect(s.knownValues().sort()).toEqual(['mystery-value-xyz', 'postgres://localhost:5432/backend_svoboda_reality_dev'])
    expect(warnings).toEqual(['backend/.env: key MYSTERY_VALUE is not classified; treating its value as secret'])
    expect(warnings.join()).not.toContain('mystery-value-xyz')
  })

  it('preload registers secret values found on disk', () => {
    const { s } = store()
    const p = s.pathOf('backend/.env')
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, 'PAYLOAD_SECRET="on-disk-secret-1"\nPORT=3211\n')
    const fresh = new FileSecretStore({ backend: dirname(p), site: '/nonexistent' })
    fresh.preload()
    expect(fresh.knownValues()).toEqual(['on-disk-secret-1'])
    expect(dotenvToRecord(readFileSync(p, 'utf8')).PAYLOAD_SECRET).toBe('on-disk-secret-1')
  })
})

describe('redact', () => {
  it('replaces known values, longest first', () => {
    expect(redact('a sekret-abcdefgh and sekret-abcdefgh-longer', ['sekret-abcdefgh', 'sekret-abcdefgh-longer'])).toBe(`a ${REDACTED} and ${REDACTED}`)
  })
  it('ignores short values (ports, ids)', () => {
    expect(redact('port 3211 id 1', ['3211', '1'])).toBe('port 3211 id 1')
  })
  it('redacts secret-shaped assignments and headers whatever the value', () => {
    const out = redact(
      [
        'CMS_API_KEY=abc123',
        'PAYLOAD_SECRET="x y"',
        'DATABASE_URL=postgres://u:p@h/db',
        'Authorization: users API-Key 0123-4567',
        'Authorization: JWT eyJhbGci.payload.sig',
        '{"password":"hunter22"}',
        'connect postgresql://cw:pw123@localhost/db',
        'TENANT_ID=3',
      ].join('\n'),
    )
    expect(out).not.toMatch(/abc123|x y|u:p@|0123-4567|eyJhbGci|hunter22|pw123/)
    expect(out).toContain('TENANT_ID=3')
  })
})

describe('exec registration', () => {
  it('slug and paths stay allowed and unredacted; DATABASE_URL/PAYLOAD_SECRET values are refused and redacted', async () => {
    const r = new Redactor()
    const exec = new NodeExec({ redactor: r })
    const dir = tmp()
    const env = {
      TENANT_SLUG: 'svoboda-reality',
      PORT: '3211',
      CLIENT_EMAIL: 'jana@svoboda-reality.cz',
      NEXT_PUBLIC_CMS_URL: 'http://localhost:3211',
      PAYLOAD_SECRET: 'payload-secret-value-1',
      DATABASE_URL: 'postgres://localhost:5432/backend_svoboda_reality_dev',
    }
    const res = await exec.run(['node', '-e', 'console.log(process.env.TENANT_SLUG, process.env.PAYLOAD_SECRET, process.env.DATABASE_URL, process.env.CLIENT_EMAIL)'], { cwd: dir, env })
    expect(res.stdout.trim()).toBe(`svoboda-reality ${REDACTED} ${REDACTED} jana@svoboda-reality.cz`)
    expect(() => exec.assertAllowed(['git', '-C', '/x/clients/backend-svoboda-reality', 'status'])).not.toThrow()
    expect(() => exec.assertAllowed(['echo', 'payload-secret-value-1'])).toThrow(/secret value/)
    expect(() => exec.assertAllowed(['psql', 'postgres://localhost:5432/backend_svoboda_reality_dev'])).toThrow(/secret value/)
  })

  it('secretEnv values are always treated as secrets', async () => {
    const r = new Redactor()
    const exec = new NodeExec({ redactor: r })
    const res = await exec.run(['node', '-e', 'console.log(process.env.WHATEVER)'], { cwd: tmp(), secretEnv: { WHATEVER: 'plain-looking-value' } })
    expect(res.stdout.trim()).toBe(REDACTED)
  })
})
