import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * A fake Payload CMS for export tests: the read endpoints a REALVISTA site
 * calls, answered from theme-kit's canonical fixtures, plus media and the
 * enquiry POST.
 *
 * It honours the query parameters the content client actually sends
 * (`where[slug][equals]`, `where[featured][equals]`, status, limit/page), so a
 * listing detail page renders the listing it asked for, and it requires the
 * `users API-Key <key>` header so a site that forgot its key fails here the
 * way it would against the real backend.
 *
 * Port 4150 by default (WP5's block). Run standalone:
 *   node --import tsx fixtures/fake-cms/server.ts <platformRoot> [port]
 */

export interface FakeCmsData {
  settings: unknown
  listings: Array<Record<string, unknown>>
  posts: Array<Record<string, unknown>>
  services: Array<Record<string, unknown>>
}

export interface FakeCms {
  url: string
  port: number
  /** every request, as `METHOD /path?query` */
  requests: string[]
  enquiries: unknown[]
  close(): Promise<void>
}

/** theme-kit's `full` fixture, loaded from the platform checkout's sources. */
export async function loadThemeKitFixture(platformRoot: string, name = 'full'): Promise<FakeCmsData> {
  const mod = (await import(pathToFileURL(path.join(platformRoot, 'packages/theme-kit/src/fixtures/index.ts')).href)) as {
    themeFixtures(variant: string): Array<{ name: string } & FakeCmsData>
  }
  const f = mod.themeFixtures('indigo').find((x) => x.name === name)
  if (!f) throw new Error(`theme-kit has no fixture ${name}`)
  return { settings: f.settings, listings: f.listings, posts: f.posts, services: f.services }
}

// 1×1 transparent PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const get = (o: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o)

function applyWhere(docs: Array<Record<string, unknown>>, q: URLSearchParams) {
  let out = docs
  const inLists = new Map<string, string[]>()
  for (const [k, v] of q) {
    const m = /^where\[([^\]]+)\]\[(equals|in)\](?:\[\d+\])?$/.exec(k)
    if (!m) continue
    const [, field, op] = m as unknown as [string, string, string]
    if (op === 'in') inLists.set(field, [...(inLists.get(field) ?? []), v])
    else out = out.filter((d) => String(get(d, field)) === v)
  }
  for (const [field, values] of inLists) out = out.filter((d) => values.includes(String(get(d, field))))
  return out
}

function paginate(docs: unknown[], q: URLSearchParams) {
  const limit = Number(q.get('limit') ?? 10)
  const page = Number(q.get('page') ?? 1)
  const totalPages = Math.max(1, Math.ceil(docs.length / limit))
  return {
    docs: docs.slice((page - 1) * limit, page * limit),
    totalDocs: docs.length,
    limit,
    page,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}

export async function startFakeCms(o: { data: FakeCmsData; port?: number; apiKey?: string; host?: string }): Promise<FakeCms> {
  const requests: string[] = []
  const enquiries: unknown[] = []
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake-cms')
    requests.push(`${req.method} ${url.pathname}${url.search}`)
    if (o.apiKey && req.headers.authorization !== `users API-Key ${o.apiKey}`) {
      return send(res, 401, { errors: [{ message: 'You are not allowed to perform this action.' }] })
    }
    const q = url.searchParams
    const p = url.pathname
    if (req.method === 'GET' && p === '/api/site-settings') return send(res, 200, paginate(o.data.settings ? [o.data.settings] : [], q))
    if (req.method === 'GET' && p === '/api/properties') return send(res, 200, paginate(applyWhere(o.data.listings, q), q))
    if (req.method === 'GET' && p === '/api/posts') return send(res, 200, paginate(applyWhere(o.data.posts, q), q))
    if (req.method === 'GET' && p === '/api/services') return send(res, 200, paginate(o.data.services, q))
    if (req.method === 'GET' && p.startsWith('/api/media/file/')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(PIXEL)
    }
    if (req.method === 'POST' && p === '/api/enquiries') {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString('utf8')))
      req.on('end', () => {
        enquiries.push(JSON.parse(body || '{}'))
        send(res, 201, { doc: { id: enquiries.length } })
      })
      return
    }
    send(res, 404, { errors: [{ message: 'Not Found' }] })
  })

  const port = o.port ?? 4150
  const host = o.host ?? '127.0.0.1'
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
  return {
    url: `http://${host}:${port}`,
    port,
    requests,
    enquiries,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [platformRoot = process.cwd(), port = '4150'] = process.argv.slice(2)
  const data = await loadThemeKitFixture(path.resolve(platformRoot))
  const cms = await startFakeCms({ data, port: Number(port), apiKey: process.env.FAKE_CMS_API_KEY })
  console.log(`fake CMS on ${cms.url}`)
}
