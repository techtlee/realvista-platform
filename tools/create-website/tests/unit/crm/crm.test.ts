import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CrmClient } from '../../../src/crm/client.js'
import { FetchHttp } from '../../../src/crm/http.js'
import { enqueue, flushOutbox } from '../../../src/crm/outbox.js'
import { Redactor } from '../../../src/redact.js'
import { MemoryStateStore } from '../../../src/state/store.js'
import { baseState } from '../../helpers/fakeWorld.js'
import { tmp } from '../../helpers/tmp.js'

/** Fake CRM: dedupes log entries on key like C2; answers leads 12 (ok), 13 (422), 14 (409). */
function fakeCrm() {
  const log: Array<Record<string, unknown>> = []
  const auths: string[] = []
  let down = false
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    for await (const c of req) body += c
    auths.push(String(req.headers.authorization))
    const send = (status: number, o: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    if (down) return send(503, { error: 'down' })
    if (req.url === '/api/users/login' && req.method === 'POST') {
      const b = JSON.parse(body)
      return b.password === 'staff-password-1' ? send(200, { token: 'jwt-token-abcdefgh' }) : send(401, {})
    }
    if (!String(req.headers.authorization).match(/^(users API-Key key-0123456789|JWT jwt-token-abcdefgh)$/)) return send(401, {})
    const m = /^\/api\/leads\/(\d+)\/provisioning-request$/.exec(req.url ?? '')
    if (m) {
      if (m[1] === '12') return send(200, { requestVersion: 1, slug: 'svoboda-reality' })
      if (m[1] === '13') return send(422, { missing: ['plan.tier', 'domain.situation'] })
      if (m[1] === '14') return send(409, { error: 'no site' })
      return send(404, {})
    }
    if (req.url === '/api/sites/3?depth=0') return send(200, { id: 3, slug: 'svoboda-reality', status: 'provisioning' })
    if (req.url === '/api/sites/4/provisioning-log') return send(404, { error: 'Nenalezeno.' })
    if (req.url === '/api/sites/3/provisioning-log' && req.method === 'POST') {
      const e = JSON.parse(body)
      if (!['ok', 'failed', 'skipped'].includes(e.status)) return send(400, { issues: [{ path: 'status', message: 'Invalid option' }] })
      if (log.some((x) => x.key === e.key)) return send(200, { appended: false })
      log.push(e)
      return send(201, { appended: true })
    }
    send(404, {})
  }
  const srv = createServer((req, res) => void handler(req, res))
  return {
    srv,
    log,
    auths,
    setDown: (d: boolean) => {
      down = d
    },
    async start() {
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
      return `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    },
  }
}

const servers: Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

async function setup() {
  const crm = fakeCrm()
  servers.push(crm.srv)
  const url = await crm.start()
  return { crm, url, client: new CrmClient(url, new FetchHttp(), { apiKey: 'key-0123456789' }) }
}

describe('CrmClient', () => {
  it('fetches an envelope; 422 lists missing fields; 409 means no site', async () => {
    const { client } = await setup()
    expect(await client.getProvisioningRequest(12)).toMatchObject({ slug: 'svoboda-reality' })
    await expect(client.getProvisioningRequest(13)).rejects.toMatchObject({ code: 'CRM_UNQUALIFIED', details: { missing: ['plan.tier', 'domain.situation'] } })
    await expect(client.getProvisioningRequest(14)).rejects.toMatchObject({ code: 'CRM_NO_SITE' })
    await expect(client.getProvisioningRequest(99)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await client.getSite(3)).toEqual({ id: 3, slug: 'svoboda-reality', status: 'provisioning' })
  })

  it('auth order: API key file, then login with the credentials file (JWT in memory, redacted)', async () => {
    const { url, crm } = await setup()
    const dir = tmp()
    const keyFile = join(dir, '.env.provisioner.local')
    writeFileSync(keyFile, 'CW_CRM_API_KEY=key-0123456789\nCW_CRM_EMAIL=p@x\n')
    const r = new Redactor()
    await new CrmClient(url, new FetchHttp(), { apiKeyFile: keyFile }, r).getSite(3)
    expect(r.redact('key-0123456789')).toBe('[REDACTED]')
    const creds = join(dir, '.admin-credentials.local')
    writeFileSync(creds, 'CRM_STAFF_EMAIL=staff@x.cz\nCRM_STAFF_PASSWORD=staff-password-1\n')
    await new CrmClient(url, new FetchHttp(), { credentialsFile: creds }, r).getSite(3)
    expect(crm.auths).toContain('JWT jwt-token-abcdefgh')
    expect(r.redact('jwt-token-abcdefgh staff-password-1')).toBe('[REDACTED] [REDACTED]')
  })

  it('seed:provisioner key file as the (default) credentials file: API key used directly, key and email redacted', async () => {
    const { url, crm } = await setup()
    const dir = tmp()
    const f = join(dir, '.env.provisioner.local')
    writeFileSync(f, 'CW_CRM_API_KEY=key-0123456789\nCW_CRM_EMAIL=provisioner@realvista.local\n')
    const r = new Redactor()
    await new CrmClient(url, new FetchHttp(), { credentialsFile: f }, r).getSite(3)
    expect(crm.auths.at(-1)).toBe('users API-Key key-0123456789')
    expect(r.redact('key-0123456789 provisioner@realvista.local')).toBe('[REDACTED] [REDACTED]')
  })

  it('appendLog: 201 appended, 200 already there, 400 issues, 404 site', async () => {
    const { client } = await setup()
    const e = { key: 'cw-x:verify:ok', step: 'verify', status: 'ok' as const, at: '2026-11-08T12:00:00.000Z', detail: '' }
    expect(await client.appendLog(3, e, 'cw-x')).toEqual({ appended: true })
    expect(await client.appendLog(3, e, 'cw-x')).toEqual({ appended: false })
    await expect(client.appendLog(3, { ...e, key: 'k2', status: 'weird' as never }, 'cw-x')).rejects.toThrow(/status: Invalid option/)
    await expect(client.appendLog(4, e, 'cw-x')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('unreachable CRM → CRM_UNREACHABLE', async () => {
    const c = new CrmClient('http://127.0.0.1:1', new FetchHttp(), { apiKey: 'key-0123456789' })
    await expect(c.getProvisioningRequest(12)).rejects.toMatchObject({ code: 'CRM_UNREACHABLE' })
  })
})

describe('outbox', () => {
  it('dedupes on key locally and server-side; flush is idempotent', async () => {
    const { client, crm } = await setup()
    const st = new MemoryStateStore(baseState())
    expect(enqueue(st, { step: 'verify', status: 'ok', detail: 'x' })).not.toBeNull()
    expect(enqueue(st, { step: 'verify', status: 'ok', detail: 'again' })).toBeNull()
    enqueue(st, { step: 'github-repos', status: 'skipped', detail: 'local mode; plan in outward-plan.md' })
    expect(await flushOutbox(st, client, 3)).toEqual({ crm: 'ok', sent: 2, alreadyThere: 0, pending: 0 })
    // a lost "sent" flag (crash after POST) is harmless: the server says 200
    st.update((s) => {
      s.crmOutbox[0]!.sent = false
    })
    expect(await flushOutbox(st, client, 3)).toEqual({ crm: 'ok', sent: 0, alreadyThere: 1, pending: 0 })
    expect(crm.log.map((e) => e.key)).toEqual(['cw-20261108T120301Z-7f3a:verify:ok', 'cw-20261108T120301Z-7f3a:github-repos:skipped'])
    expect(crm.log[0]).toMatchObject({ runId: 'cw-20261108T120301Z-7f3a', step: 'verify', status: 'ok' })
  })

  it('an outage keeps entries sent:false and never throws; the next flush delivers', async () => {
    const { client, crm } = await setup()
    const st = new MemoryStateStore(baseState())
    enqueue(st, { step: 'backend-seed', status: 'ok', detail: '' })
    enqueue(st, { step: 'verify', status: 'ok', detail: '' })
    crm.setDown(true)
    const r = await flushOutbox(st, client, 3)
    expect(r.crm).toBe('pending')
    expect(r.pending).toBe(2)
    expect(st.get().crmOutbox.every((e) => !e.sent)).toBe(true)
    expect(st.get().crmOutbox[0]!.lastError).toMatch(/503/)
    crm.setDown(false)
    expect(await flushOutbox(st, client, 3)).toMatchObject({ crm: 'ok', sent: 2 })
  })

  it('no CRM / no site id → crm:none, entries stay queued', async () => {
    const st = new MemoryStateStore(baseState())
    enqueue(st, { step: 'verify', status: 'ok', detail: '' })
    expect(await flushOutbox(st, null, 3)).toMatchObject({ crm: 'none', pending: 1 })
    const { client } = await setup()
    expect(await flushOutbox(st, client, undefined)).toMatchObject({ crm: 'none', pending: 1 })
  })
})
