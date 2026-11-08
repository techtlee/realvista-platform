import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { main } from '../../../src/cli.js'
import { tmp } from '../../helpers/tmp.js'

const FIXTURE = join(import.meta.dirname, '../input/fixtures/svoboda.request.json')
const REGISTRY = join(import.meta.dirname, 'fixtures/markerRegistry.ts')

function sandbox(extra: Record<string, unknown> = {}) {
  const root = tmp('cwunit4-cli-')
  writeFileSync(
    join(root, 'create-website.config.json'),
    JSON.stringify({
      clientsDir: './clients',
      platformRepo: './platform',
      cmsRepo: './cms',
      dbPrefix: 'cwunit4_',
      testMode: true,
      ports: { site: [4410, 4419], backend: [4420, 4429], reserved: [] },
      ...extra,
    }),
  )
  return root
}

async function cw(root: string, args: string[], env: Record<string, string> = {}) {
  let out = ''
  let err = ''
  const code = await main(args, {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CW_STEPS_MODULE: REGISTRY, ...env },
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
  })
  let json: any = null
  try {
    json = JSON.parse(out)
  } catch {
    /* help text */
  }
  return { code, out, err, json }
}

const runsOf = (root: string) => readFileSync(join(root, 'clients/svoboda-reality/runs.log'), 'utf8').trim().split('\n')

describe('cw CLI', () => {
  it('--help', async () => {
    const r = await cw(sandbox(), ['--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('Usage: cw <command>')
    expect(r.out).toContain('OUTWARD_ENABLED=false')
  })

  it('validate: ok, then exit 2 with per-path issues for a purple colourway', async () => {
    const root = sandbox()
    const ok = await cw(root, ['validate', '--request', FIXTURE, '--json'])
    expect(ok.code).toBe(0)
    expect(ok.out.trim().split('\n')).toHaveLength(1)
    expect(ok.json).toMatchObject({ ok: true, slug: 'svoboda-reality', theme: { variant: 'indigo' } })
    const bad = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    bad.provisioning.theme.variant = 'purple'
    writeFileSync(join(root, 'purple.json'), JSON.stringify(bad))
    const r = await cw(root, ['validate', '--request', 'purple.json'])
    expect(r.code).toBe(2)
    expect(r.json.issues.some((i: any) => i.path === 'provisioning.theme.variant')).toBe(true)
    expect(existsSync(join(root, 'clients'))).toBe(false)
  })

  it('validate with --json <file> (bare JSON) and flags', async () => {
    const root = sandbox()
    const env = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    writeFileSync(join(root, 'provisioning.json'), JSON.stringify(env.provisioning))
    const r = await cw(root, ['validate', '--json', 'provisioning.json', '--slug', 'dvorak-reality', '--contact-name', 'Petr Dvořák', '--contact-email', 'petr@dvorak.cz'])
    expect(r.code).toBe(0)
    expect(r.json).toMatchObject({ ok: true, source: 'bare-json', slug: 'dvorak-reality' })
  })

  it('status of an unknown slug → NOT_FOUND, exit 4, error shape', async () => {
    const r = await cw(sandbox(), ['status', 'nobody', '--json'])
    expect(r.code).toBe(4)
    expect(Object.keys(r.json).sort()).toEqual(['code', 'hint', 'message', 'ok', 'statePath', 'step'])
    expect(r.json.code).toBe('NOT_FOUND')
  })

  it.each([
    [['secret-pipe', 'svoboda-reality', 'backend', '.env', 'DATABASE_URL']],
    [['secret-pipe', '--write', 'site/.env.production.local', 'CMS_API_KEY', '--from-file', '/tmp/k', '--delete-source']],
    [['secret-pipe', '--generate', 'backend/.env.production.local', 'PAYLOAD_SECRET']],
  ])('secret-pipe %j refuses with OUTWARD_REFUSED (exit 7)', async (args) => {
    const r = await cw(sandbox(), args)
    expect(r.code).toBe(7)
    expect(r.json.code).toBe('OUTWARD_REFUSED')
  })

  it('CW_STEPS_MODULE / CW_TEST_HOOKS are refused under a non-test config', async () => {
    const root = sandbox({ testMode: false })
    const r = await cw(root, ['run', '--request', FIXTURE])
    expect(r.json.code).toBe('TEST_HOOKS_REFUSED')
    const h = await cw(root, ['validate', '--request', FIXTURE], { CW_TEST_HOOKS: '1' })
    expect(h.code).toBe(4)
  })

  it('run → status → resume after a failure → no re-runs, same runId, creds untouched', async () => {
    const root = sandbox()
    process.env.CW_UNIT_FAIL = 'site-build' // read in-process by the marker registry
    const r1 = await cw(root, ['run', '--request', FIXTURE]).finally(() => delete process.env.CW_UNIT_FAIL)
    expect(r1.code).toBe(5)
    expect(r1.json).toMatchObject({ ok: false, code: 'STEP_FAILED', step: 'site-build' })
    expect(r1.json.crm.crm).toBe('none') // no crm configured
    const st1 = await cw(root, ['status', 'svoboda-reality'])
    expect(st1.json).toMatchObject({ next: 'site-build', lastError: { step: 'site-build', code: 'STEP_FAILED' }, ports: { site: 4410, backend: 4420 } })
    const credsPath = join(root, 'clients/backend-svoboda-reality/.admin-credentials.local')
    const creds = readFileSync(credsPath, 'utf8')
    expect(statSync(credsPath).mode & 0o777).toBe(0o600)

    const r2 = await cw(root, ['run', 'svoboda-reality'])
    expect(r2.code).toBe(0)
    expect(r2.json.runId).toBe(r1.json.runId)
    expect(readFileSync(credsPath, 'utf8')).toBe(creds)
    const runs = runsOf(root)
    expect(runs.filter((x) => x === 'backend-credentials')).toHaveLength(1)
    expect(runs.filter((x) => x === 'site-build')).toHaveLength(1)

    const st2 = await cw(root, ['status', 'svoboda-reality'])
    expect(st2.json).toMatchObject({ complete: true, next: null })
    expect(st2.json.counts).toMatchObject({ planned: 9 })
    // the state file and logs never hold the generated password
    const pw = /CLIENT_PASSWORD=(\S+)/.exec(creds)![1]!
    expect(readFileSync(join(root, 'clients/svoboda-reality/create-website.state.json'), 'utf8')).not.toContain(pw)
    const sc = await cw(root, ['secrets-check', 'svoboda-reality'])
    expect(sc.json).toMatchObject({ ok: true })
    // show-login gives the path, never the password
    const login = await cw(root, ['show-login', 'svoboda-reality'])
    expect(login.out).not.toContain(pw)
    expect(login.json).toMatchObject({ realtorEmail: 'jana@svoboda-reality.cz', credentialsFile: credsPath })
  })

  it('a changed request for the same slug → INPUT_CHANGED (exit 3); another lead → SLUG_TAKEN', async () => {
    const root = sandbox()
    expect((await cw(root, ['run', '--request', FIXTURE])).code).toBe(0)
    const changed = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    changed.provisioning.brand.tagline = 'Jiný slogan'
    writeFileSync(join(root, 'changed.json'), JSON.stringify(changed))
    const r = await cw(root, ['run', '--request', 'changed.json'])
    expect(r.code).toBe(3)
    expect(r.json.code).toBe('INPUT_CHANGED')
    changed.crm.leadId = 99
    writeFileSync(join(root, 'other.json'), JSON.stringify(changed))
    expect((await cw(root, ['run', '--request', 'other.json'])).json.code).toBe('SLUG_TAKEN')
  })

  it('secrets-check finds a planted value in a log', async () => {
    const root = sandbox()
    await cw(root, ['run', '--request', FIXTURE])
    const creds = readFileSync(join(root, 'clients/backend-svoboda-reality/.admin-credentials.local'), 'utf8')
    const pw = /CLIENT_PASSWORD=(\S+)/.exec(creds)![1]!
    writeFileSync(join(root, 'clients/svoboda-reality/logs/leak.log'), `oops ${pw.slice(3, 20)}\n`)
    const r = await cw(root, ['secrets-check', 'svoboda-reality'])
    expect(r.code).toBe(5)
    expect(r.json.hits).toEqual([{ file: 'svoboda-reality/logs/leak.log', key: 'backend/.admin-credentials.local:CLIENT_PASSWORD', kind: 'substring' }])
    expect(r.out).not.toContain(pw)
  })

  it('plan executes nothing', async () => {
    const root = sandbox()
    const r = await cw(root, ['plan', '--request', FIXTURE, '--outward'])
    expect(r.code).toBe(0)
    expect(r.json.executed).toBe(false)
    expect(r.json.steps).toHaveLength(9)
    expect(existsSync(join(root, 'clients'))).toBe(false)
  })

  it('teardown needs --yes --confirm-slug and then removes only this client', async () => {
    const root = sandbox()
    await cw(root, ['run', '--request', FIXTURE])
    expect((await cw(root, ['teardown', 'svoboda-reality', '--yes'])).code).toBe(2)
    const r = await cw(root, ['teardown', 'svoboda-reality', '--yes', '--confirm-slug', 'svoboda-reality'])
    expect(r.code).toBe(0)
    expect(existsSync(join(root, 'clients/svoboda-reality'))).toBe(false)
    expect(existsSync(join(root, 'clients/backend-svoboda-reality'))).toBe(false)
    expect(r.json.done).toContain('kept database cwunit4_backend_svoboda_reality_dev (not created by this tool)')
  })
})
