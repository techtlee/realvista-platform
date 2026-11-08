/**
 * Acceptance checks (runbook Phase D), recorded as `{check, ok, detail}`.
 * Each check is independent: one failing does not stop the others, so
 * `cw verify` always reports the whole picture.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { backendQueryFactory, countRows } from '../backend/db.js'
import { siteConfigInputFor } from '../site/index.js'
import type { Ctx, VerifyCheck } from '../types.js'
import { secretsCheck } from './secretsCheck.js'

export type Check = (ctx: Ctx) => Promise<Omit<VerifyCheck, 'check'>>

const ok = (detail: string) => ({ ok: true, detail })
const fail = (detail: string) => ({ ok: false, detail })

function site(ctx: Ctx): string {
  return `http://localhost:${ctx.state.get().ports.site}`
}
function backend(ctx: Ctx): string {
  return `http://localhost:${ctx.state.get().ports.backend}`
}

async function get(ctx: Ctx, url: string, headers?: Record<string, string>) {
  return ctx.http.request({ url, headers, timeoutMs: 15_000, redirect: 'manual' })
}

/** `data-section="…"` ids in document order. */
export function sectionOrder(html: string): string[] {
  return [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]!)
}

export function variantOf(html: string): string | null {
  return /<html[^>]*\sdata-variant="([^"]+)"/.exec(html)?.[1] ?? null
}

export function expectedSections(ctx: Ctx): string[] | null {
  const cfg = siteConfigInputFor(ctx.request, { subdomainBase: ctx.cfg.subdomainBase, tenantId: ctx.state.get().tenantId })
  return (cfg as { pages?: { home?: { sections?: string[] } } }).pages?.home?.sections ?? null
}

/** Relative import specifiers (static, dynamic, export-from) in a source file. */
export function relativeSpecifiers(source: string): string[] {
  const out: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g
  for (const m of source.matchAll(re)) out.push(m[1]!)
  return out
}

export const CHECKS: Record<string, Check> = {
  async 'package-standalone'(ctx) {
    const pkg = readFileSync(join(ctx.paths.site, 'package.json'), 'utf8')
    const bad = pkg.match(/"(workspace:|link:|file:)[^"]*"|"\.\.\/[^"]*"/g)
    return bad ? fail(`package.json references outside the repo: ${bad.join(', ')}`) : ok('registry dependencies only')
  },

  async 'imports-inside-repo'(ctx) {
    const r = await ctx.exec.run(['git', 'ls-files', '-z'], { cwd: ctx.paths.site })
    const files = r.stdout.split('\0').filter((f) => /\.(tsx?|mts|jsx?|mjs|css)$/.test(f))
    const root = resolve(ctx.paths.site)
    let count = 0
    const outside: string[] = []
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8')
      const specs = f.endsWith('.css') ? [...text.matchAll(/@(?:import|source)\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]!) : relativeSpecifiers(text)
      for (const s of specs) {
        count++
        const target = resolve(dirname(join(root, f)), s)
        if (target !== root && !target.startsWith(root + '/')) outside.push(`${f}: ${s}`)
      }
    }
    if (existsSync(join(root, 'node_modules', '@makleri'))) outside.push('node_modules/@makleri exists')
    return outside.length ? fail(outside.slice(0, 10).join('; ')) : ok(`${count} relative specifiers, 0 outside the repo; no node_modules/@makleri`)
  },

  async typecheck(ctx) {
    const r = await ctx.exec.run(['pnpm', 'typecheck'], {
      cwd: ctx.paths.site,
      allowFailure: true,
      logFile: ctx.log.stepLog('verify'),
      timeoutMs: 10 * 60_000,
    })
    return r.code === 0 ? ok('pnpm typecheck exit 0') : fail(`pnpm typecheck exit ${r.code}: ${(r.stdout + r.stderr).split('\n').filter(Boolean).slice(-3).join(' | ')}`)
  },

  async variant(ctx) {
    const r = await get(ctx, `${site(ctx)}/`)
    const want = ctx.request.provisioning.theme.variant
    const got = variantOf(r.text)
    return r.status === 200 && got === want ? ok(`data-variant=${got}`) : fail(`HTTP ${r.status}, data-variant=${got ?? 'none'}, want ${want}`)
  },

  async 'section-order'(ctx) {
    const r = await get(ctx, `${site(ctx)}/`)
    const got = sectionOrder(r.text)
    const want = expectedSections(ctx)
    if (!want) return got.length ? ok(`theme default order: ${got.join(',')}`) : fail('no [data-section] markers on /')
    return got.join(',') === want.join(',') ? ok(got.join(',')) : fail(`rendered ${got.join(',') || '(none)'}, want ${want.join(',')}`)
  },

  async routes(ctx) {
    const paths = ['/nemovitosti', '/zasady-ochrany-osobnich-udaju', '/cookies']
    if (ctx.request.provisioning.modules.blog) paths.push('/blog')
    const list = await get(ctx, `${site(ctx)}/nemovitosti`)
    const detail = /href="(\/nemovitosti\/[^"?#]+)"/.exec(list.text)?.[1]
    if (detail) paths.push(detail)
    const bad: string[] = []
    const good: string[] = []
    for (const p of paths) {
      const st = (await get(ctx, `${site(ctx)}${p}`)).status
      ;(st === 200 ? good : bad).push(`${p} ${st}`)
    }
    if (!detail) bad.push('no listing detail link on /nemovitosti')
    return bad.length ? fail(bad.join(', ')) : ok(good.join(', '))
  },

  async media(ctx) {
    const tenant = ctx.state.get().tenantId
    const rows = await backendQueryFactory(ctx)(
      "select filename from media where tenant_id = $1 and filename is not null and mime_type like 'image/%' order by id limit 1",
      [tenant],
    ).catch(() => [])
    const name = rows[0]?.filename as string | undefined
    if (!name) return fail('no seeded image in media')
    const r = await get(ctx, `${site(ctx)}/api/media/file/${encodeURIComponent(name)}`)
    const type = r.headers['content-type'] ?? ''
    return r.status === 200 && type.startsWith('image/') ? ok(`${name} ${r.status} ${type}`) : fail(`${name} → HTTP ${r.status} ${type}`)
  },

  async enquiry(ctx) {
    const tenant = ctx.state.get().tenantId
    const count = () => countRows(ctx, 'select count(*)::int as n from enquiries where tenant_id = $1', [tenant])
    const email = `cw-verify+${ctx.state.get().runId.toLowerCase()}@example.invalid`
    const post = (extra: Record<string, string>) =>
      ctx.http.request({
        method: 'POST',
        url: `${site(ctx)}/api/poptavka`,
        headers: { 'content-type': 'application/x-www-form-urlencoded', referer: `${site(ctx)}/` },
        body: new URLSearchParams({ name: 'Ověření Provisioningu', email, message: 'Automatická kontrola /create-website.', consent: 'on', ...extra }).toString(),
        redirect: 'manual',
        timeoutMs: 15_000,
      })
    const before = await count()
    const r1 = await post({})
    const afterReal = await count()
    const r2 = await post({ website: 'http://spam.invalid' })
    const afterSpam = await count()
    const cleaned = await deleteTestEnquiries(ctx, email)
    const okReal = r1.status === 303 && afterReal === before + 1
    const okSpam = r2.status === 303 && afterSpam === afterReal
    const detail = `real POST ${r1.status} (+${afterReal - before}), honeypot POST ${r2.status} (+${afterSpam - afterReal}), test enquiry ${cleaned}`
    return okReal && okSpam ? ok(detail) : fail(detail)
  },

  async 'revalidate-round-trip'(ctx) {
    // B1 regression guard: a realtor's save must reach the site within 10 s.
    const email = await ctx.secrets.get({ file: 'backend/.admin-credentials.local', key: 'CLIENT_EMAIL' })
    const password = await ctx.secrets.get({ file: 'backend/.admin-credentials.local', key: 'CLIENT_PASSWORD' })
    if (!email || !password) return fail('realtor credentials missing')
    const token = await login(ctx, email, password)
    if (!token) return fail('realtor login failed')
    const auth = { Authorization: `JWT ${token}`, 'content-type': 'application/json' }
    const list = await ctx.http.request({ url: `${backend(ctx)}/api/site-settings?limit=1&depth=0&locale=cs`, headers: auth, timeoutMs: 15_000 })
    const doc = (JSON.parse(list.text || '{}') as { docs?: Array<{ id: number; hero?: { headline?: string } }> }).docs?.[0]
    if (!doc) return fail(`realtor sees no site settings (HTTP ${list.status})`)
    const original = doc.hero?.headline ?? ''
    const nonce = `Ověření ${Date.now().toString(36)}`
    const patch = (headline: string) =>
      ctx.http.request({
        method: 'PATCH',
        url: `${backend(ctx)}/api/site-settings/${doc.id}?locale=cs`,
        headers: auth,
        body: JSON.stringify({ hero: { headline } }),
        timeoutMs: 15_000,
      })
    const p1 = await patch(nonce)
    if (p1.status !== 200) return fail(`PATCH as realtor → HTTP ${p1.status}`)
    const started = Date.now()
    let seen = false
    while (Date.now() - started < 10_000) {
      const r = await get(ctx, `${site(ctx)}/`)
      if (r.text.includes(nonce)) {
        seen = true
        break
      }
      await new Promise((res) => setTimeout(res, 500))
    }
    const ms = Date.now() - started
    const p2 = await patch(original)
    // Wait for the restore to land too, so the next check (and Josef) see the real headline.
    const restoreEnd = Date.now() + 10_000
    while (Date.now() < restoreEnd && (await get(ctx, `${site(ctx)}/`)).text.includes(nonce)) await new Promise((res) => setTimeout(res, 500))
    const restored = p2.status === 200 ? 'restored' : `restore HTTP ${p2.status}`
    return seen ? ok(`edit visible after ${ms} ms; ${restored}`) : fail(`edit not visible within 10 s; ${restored}`)
  },

  async 'secrets-check'(ctx) {
    const r = await secretsCheck(ctx)
    return r.ok
      ? ok(`${r.scannedFiles} files scanned, ${r.secretsKnown} secrets known, 0 hits`)
      : fail(r.hits.slice(0, 10).map((h) => `${h.file} (${h.key}, ${h.kind})`).join('; '))
  },
}

async function login(ctx: Ctx, email: string, password: string): Promise<string | null> {
  const r = await ctx.http.request({
    method: 'POST',
    url: `${backend(ctx)}/api/users/login`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    timeoutMs: 15_000,
  })
  if (r.status !== 200) return null
  return (JSON.parse(r.text) as { token?: string }).token ?? null
}

/** Deletes the verify enquiries through the platform-admin REST login (never raw SQL on content). */
async function deleteTestEnquiries(ctx: Ctx, email: string): Promise<string> {
  const creds = 'backend/.admin-credentials.local' as const
  const a = await ctx.secrets.get({ file: creds, key: 'MAKLERI_ADMIN_EMAIL' })
  const p = await ctx.secrets.get({ file: creds, key: 'MAKLERI_ADMIN_PASSWORD' })
  if (!a || !p) return 'not deleted (no admin credentials)'
  const token = await login(ctx, a, p)
  if (!token) return 'not deleted (admin login failed)'
  const r = await ctx.http.request({
    method: 'DELETE',
    url: `${backend(ctx)}/api/enquiries?${new URLSearchParams({ 'where[email][equals]': email }).toString()}`,
    headers: { Authorization: `JWT ${token}` },
    timeoutMs: 15_000,
  })
  return r.status === 200 ? 'deleted' : `delete HTTP ${r.status}`
}

export const CHECK_ORDER = Object.keys(CHECKS)

/** Runs every check; a throwing check is recorded as failed, never aborts the rest. */
export async function runChecks(ctx: Ctx, only?: string[]): Promise<VerifyCheck[]> {
  const results: VerifyCheck[] = []
  for (const name of only ?? CHECK_ORDER) {
    const fn = CHECKS[name]
    if (!fn) continue
    try {
      results.push({ check: name, ...(await fn(ctx)) })
    } catch (e) {
      results.push({ check: name, ok: false, detail: `error: ${(e as Error).message}` })
    }
  }
  return results
}
