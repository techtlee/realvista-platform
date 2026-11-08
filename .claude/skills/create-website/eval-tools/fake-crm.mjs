#!/usr/bin/env node
// A fake internal CRM for /create-website tests and evals (design C1/C2/C3).
//
//   node fake-crm.mjs --port 4612 --data fake-crm.json --dir .fake-crm
//
// Serves, Payload-style:
//   POST /api/users/login                        {email,password} -> {token, user}
//   GET  /api/users/me
//   GET  /api/leads/:id/provisioning-request     200 envelope | 422 {missing:[...]} | 409 {error}
//   GET  /api/leads/:id                          minimal lead doc
//   GET  /api/sites/:id                          {id, slug, status, lead, provisioningLog}
//   POST /api/sites/:id/provisioning-log         append one entry, idempotent on `key`
// and, for the harness only:
//   GET  /__health, GET /__log (everything recorded), POST /__reset
//
// Every request is appended to <dir>/requests.jsonl (login bodies are never
// recorded). Accepted log entries go to <dir>/provisioning-log.jsonl. Any
// write to /api/leads* is answered 403 and recorded: the skill must never
// convert, win, qualify or PATCH a lead (staff decisions).
//
// Data file shape:
// { "apiKey": "...", "users": [{"email","password"}],
//   "leads": { "12": {"status": 200, "body": <envelope>} , "13": {"status": 422, "body": {"missing": [...]}} },
//   "sites": { "7": {"id": 7, "slug": "cerna-reality", "status": "provisioning", "lead": 12} } }
// The API key is also written to <dir>/api-key (0600, dotenv CW_CRM_API_KEY=…) for crm.apiKeyFile,
// and <dir>/credentials.local (CRM_STAFF_EMAIL/CRM_STAFF_PASSWORD) for crm.credentialsFile.
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const port = Number(args.port ?? 4390)
const dir = resolve(args.dir ?? '.fake-crm')
const data = args.data ? JSON.parse(readFileSync(args.data, 'utf8')) : { leads: {}, sites: {} }
data.leads ??= {}
data.sites ??= {}
data.users ??= [{ email: 'provisioner@realvista.test', password: 'fake-crm-password' }]
data.apiKey ??= `fake-crm-${randomBytes(12).toString('hex')}`
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'api-key'), `CW_CRM_API_KEY=${data.apiKey}\n`, { mode: 0o600 }) // dotenv, as crm.apiKeyFile is read
writeFileSync(join(dir, 'credentials.local'), `CRM_STAFF_EMAIL=${data.users[0].email}\nCRM_STAFF_PASSWORD=${data.users[0].password}\n`, { mode: 0o600 })
writeFileSync(join(dir, 'pid'), String(process.pid))

const tokens = new Set()
const logPath = join(dir, 'provisioning-log.jsonl')
const reqPath = join(dir, 'requests.jsonl')
const seenKeys = new Set(
  existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : [],
)

function authOk(req) {
  const h = req.headers.authorization ?? ''
  if (h === `users API-Key ${data.apiKey}`) return 'api-key'
  const m = h.match(/^(?:JWT|Bearer)\s+(.+)$/)
  if (m && tokens.has(m[1])) return 'jwt'
  return null
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
  return status
}

const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const url = new URL(req.url, `http://localhost:${port}`)
  const path = url.pathname.replace(/\/+$/, '')
  const method = req.method ?? 'GET'
  let body = null
  try { body = raw ? JSON.parse(raw) : null } catch { body = { _unparsed: raw.slice(0, 200) } }
  const auth = authOk(req)
  let status

  const handle = () => {
    if (path === '/__health') return send(res, 200, { ok: true })
    if (path === '/__log') {
      const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
      return send(res, 200, { requests: read(reqPath), provisioningLog: read(logPath) })
    }
    if (path === '/__reset' && method === 'POST') {
      writeFileSync(logPath, ''); writeFileSync(reqPath, ''); seenKeys.clear()
      return send(res, 200, { ok: true })
    }
    if (path === '/api/users/login' && method === 'POST') {
      const u = data.users.find((x) => x.email === body?.email && x.password === body?.password)
      if (!u) return send(res, 401, { errors: [{ message: 'The email or password provided is incorrect.' }] })
      const token = randomBytes(16).toString('hex')
      tokens.add(token)
      return send(res, 200, { token, user: { email: u.email, role: 'staff' }, exp: Math.floor(Date.now() / 1000) + 7200 })
    }
    if (!path.startsWith('/api/')) return send(res, 404, { error: 'not found' })
    if (!auth) return send(res, 401, { errors: [{ message: 'You are not allowed to perform this action.' }] })

    if (path === '/api/users/me') return send(res, 200, { user: { email: data.users[0].email, role: 'staff' } })

    let m
    if ((m = path.match(/^\/api\/leads\/(\d+)\/provisioning-request$/)) && method === 'GET') {
      const lead = data.leads[m[1]]
      if (!lead) return send(res, 404, { errors: [{ message: 'Not Found' }] })
      return send(res, lead.status ?? 200, lead.body)
    }
    if (path.startsWith('/api/leads')) {
      if (method !== 'GET') return send(res, 403, { errors: [{ message: 'Lead changes are staff decisions (fake CRM refuses).' }] })
      if ((m = path.match(/^\/api\/leads\/(\d+)$/))) {
        const lead = data.leads[m[1]]
        if (!lead) return send(res, 404, { errors: [{ message: 'Not Found' }] })
        return send(res, 200, { id: Number(m[1]), status: lead.status === 200 ? 'won' : 'qualifying' })
      }
      return send(res, 404, { error: 'not found' })
    }
    if ((m = path.match(/^\/api\/sites\/(\d+)$/)) && method === 'GET') {
      const site = data.sites[m[1]]
      if (!site) return send(res, 404, { errors: [{ message: 'Not Found' }] })
      const log = existsSync(logPath)
        ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => String(e.siteId) === m[1])
        : []
      return send(res, 200, { ...site, provisioningLog: log.map(({ siteId, ...e }) => e) })
    }
    if ((m = path.match(/^\/api\/sites\/(\d+)\/provisioning-log$/)) && method === 'POST') {
      if (!data.sites[m[1]]) return send(res, 404, { errors: [{ message: 'Not Found' }] })
      const e = body ?? {}
      const missing = ['key', 'step', 'status'].filter((k) => !e[k])
      if (missing.length) return send(res, 400, { errors: [{ message: `missing ${missing.join(', ')}` }] })
      if (!['ok', 'failed', 'skipped'].includes(e.status)) return send(res, 400, { errors: [{ message: 'bad status' }] })
      if (seenKeys.has(e.key)) return send(res, 200, { ok: true, duplicate: true })
      seenKeys.add(e.key)
      appendFileSync(logPath, JSON.stringify({ siteId: Number(m[1]), key: e.key, runId: e.runId ?? null, step: e.step, status: e.status, at: e.at ?? new Date().toISOString(), detail: e.detail ?? '', receivedAt: new Date().toISOString() }) + '\n')
      return send(res, 201, { ok: true, duplicate: false })
    }
    if (path.startsWith('/api/sites') && method !== 'GET') return send(res, 403, { errors: [{ message: 'Only provisioning-log appends are allowed.' }] })
    return send(res, 404, { error: 'not found' })
  }

  try {
    status = handle()
  } catch (err) {
    status = send(res, 500, { error: String(err) })
  }
  if (!path.startsWith('/__')) {
    const recBody = path === '/api/users/login' ? '[login body not recorded]' : body
    appendFileSync(reqPath, JSON.stringify({ at: new Date().toISOString(), method, path, status, auth, body: recBody }) + '\n')
  }
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake CRM on http://127.0.0.1:${port} (dir ${dir})\n`)
})
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)))
