/**
 * Real end-to-end provision (design §B "Integration"): svoboda-reality from the
 * fake CRM as lead 21 (friendly, indigo, services off, blog on, no domain), real
 * cms template, real platform, real Postgres, real `next build`/`next start`.
 *
 * Asserts everything `verify` claims, independently, plus git history, DB
 * counts, CRM log, idempotent re-run, show-login and teardown.
 *
 * Ports: site 4172–4176, backend 4272–4276, fake CRM 4390. DBs cwtest_<rand>_*.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OUTWARD, commits, crmLog, cw, databases, destroyRoot, duplicateTrailers, e2eEnabled, envKeyHash, explain, fileSha,
  get, git, incompleteSteps, makeRoot, mode, sectionsOf, sh, startFakeCrm, state, tenantsAndUsers, variantOf, type Root,
} from './helpers.js'

const SLUG = 'svoboda-reality'
const REALTOR = 'petra@svoboda-reality.example'
const HOME = ['hero', 'featured', 'agent', 'stats', 'contact', 'blog']

describe.skipIf(!e2eEnabled)('provision svoboda-reality from CRM lead 21 (real world)', () => {
  let root: Root
  let first: ReturnType<typeof cw>
  let st: any
  const p = (repo: 'record' | 'backend' | 'site') => join(root.clients, repo === 'record' ? SLUG : `${repo}-${SLUG}`)
  const siteUrl = () => `http://127.0.0.1:${st.ports.site}`

  beforeAll(async () => {
    root = makeRoot({ site: [4172, 4176], backend: [4272, 4276], crmPort: 4390 })
    await startFakeCrm(root, {
      leads: { 21: { status: 200, fixture: 'svoboda-lead.request.json' } },
      sites: { 9: { id: 9, slug: SLUG, status: 'provisioning', lead: 21 } },
    })
    const v = cw(root, ['validate', '--lead', '21'])
    expect(v.code, explain(v)).toBe(0)
    first = cw(root, ['run', '--lead', '21'])
    st = existsSync(join(p('record'), 'create-website.state.json')) ? state(root, SLUG) : null
  })

  afterAll(async () => {
    await destroyRoot(root)
  })

  it('cw run exits 0 with ok JSON', () => {
    expect(first.code, explain(first)).toBe(0)
    expect(first.json?.ok).toBe(true)
  })

  it('state: every local step done, outward steps planned, input from the CRM', () => {
    expect(incompleteSteps(st)).toEqual([])
    for (const id of OUTWARD) expect(st.steps[id].status, id).toBe('planned')
    expect(st.input.source).toBe('crm')
    expect(st.input.crm).toMatchObject({ leadId: 21, siteId: 9 })
    expect(st.runId).toMatch(/^cw-\d{8}T\d{6}Z-[0-9a-f]{4}$/)
    expect(st.mode).toBe('local')
    expect(st.ports.site).toBeGreaterThanOrEqual(4172)
    expect(st.ports.site).toBeLessThanOrEqual(4176)
    expect(st.ports.backend).toBeGreaterThanOrEqual(4272)
    expect(st.ports.backend).toBeLessThanOrEqual(4276)
    expect(st.db.name.startsWith(root.dbPrefix)).toBe(true)
    expect(st.templates.platform.commit).toMatch(/^[0-9a-f]{7,40}$/)
    expect(st.templates.cms.commit).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('verify recorded every acceptance check, all ok', () => {
    const failed = st.verify.filter((c: any) => !c.ok)
    expect(failed, JSON.stringify(failed)).toEqual([])
    const names = st.verify.map((c: any) => c.check).join(' ')
    for (const k of [/variant/, /section/, /revalidat/, /enquir|poptavk/, /honeypot/, /secret/, /typecheck/, /media/]) expect(names).toMatch(k)
  })

  it('site renders indigo and the home order minus services', async () => {
    const r = await get(`${siteUrl()}/`)
    expect(r.status).toBe(200)
    expect(variantOf(r.text)).toBe('indigo')
    expect(sectionsOf(r.text)).toEqual(HOME)
  })

  it('listing index, a listing detail, blog, legal pages and cookies answer 200', async () => {
    const list = await get(`${siteUrl()}/nemovitosti`)
    expect(list.status).toBe(200)
    const detail = list.text.match(/href="(\/nemovitosti\/[^"/?#]+)"/)?.[1]
    expect(detail, 'a listing link on /nemovitosti').toBeTruthy()
    expect((await get(`${siteUrl()}${detail}`)).status).toBe(200)
    // starter content: sample listings are "Ukázka – …" (E2), not client #1's Plzeň
    expect(list.text).toMatch(/Ukázka/)
    expect(list.text).not.toMatch(/Plzeň/)
    for (const path of ['/blog', '/cookies', '/zasady-ochrany-osobnich-udaju']) expect((await get(`${siteUrl()}${path}`)).status, path).toBe(200)
  })

  it('starter content invents nothing: [DOPLNIT] visible, no client #1 claims', async () => {
    const home = (await get(`${siteUrl()}/`)).text
    expect(home).toMatch(/\[DOPLNIT/)
    for (const claim of ['180+', '4,9', 'od roku 2014', '12 let', 'Jan Novák', 'Americká']) expect(home, claim).not.toContain(claim)
  })

  it('site package.json is standalone; no @makleri in node_modules', () => {
    const pkg = readFileSync(join(p('site'), 'package.json'), 'utf8')
    expect(pkg).not.toMatch(/workspace:|link:|file:|"\.\.\//)
    expect(existsSync(join(p('site'), 'node_modules', '@makleri'))).toBe(false)
  })

  it('git history: pristine copy, customize/standalone, lockfile; one commit per trailer; no remotes', () => {
    const b = commits(p('backend'))
    expect(b[0]!.subject).toMatch(/^Copy of realvista-client-backend template \(cms [0-9a-f]{7}\)$/)
    expect(b[0]!.trailers['Create-Website-Template']?.[0]).toMatch(/^cms@[0-9a-f]{40}$/)
    expect(b.length).toBeGreaterThanOrEqual(2)
    const s = commits(p('site'))
    expect(s[0]!.subject).toMatch(/^Copy of the REALVISTA site template \(platform [0-9a-f]{7}\)$/)
    expect(s[0]!.trailers['Create-Website-Template']?.[0]).toMatch(/^platform@[0-9a-f]{40}$/)
    expect(s[1]!.subject).toBe(`Make the copy standalone and configure it for ${SLUG}`)
    expect(git(p('site'), ['ls-files', 'pnpm-lock.yaml']).trim()).toBe('pnpm-lock.yaml')
    for (const d of [p('record'), p('backend'), p('site')]) {
      expect(duplicateTrailers(d), d).toEqual([])
      expect(git(d, ['remote']).trim(), `${d} must have no remote`).toBe('')
      expect(git(d, ['status', '--porcelain']).trim(), `${d} clean`).toBe('')
    }
  })

  it('exactly one tenant, one realtor user, one site key user; DB carries the prefix', () => {
    expect(databases(root)).toEqual([st.db.name])
    const { tenants, users } = tenantsAndUsers(st.db.name)
    expect(tenants).toEqual([SLUG])
    expect(users.filter((u) => u.email === REALTOR)).toHaveLength(1)
    expect(users.filter((u) => u.email.startsWith(`site+${SLUG}@`))).toHaveLength(1)
    expect(users.filter((u) => u.role === 'client' && !u.email.startsWith('site+'))).toHaveLength(1)
  })

  it('secret files are 0600 and git-ignored; secrets-check passes', () => {
    for (const f of [join(p('backend'), '.env'), join(p('backend'), '.admin-credentials.local'), join(p('site'), '.env.local')]) {
      expect(mode(f), f).toBe('600')
      const repo = f.includes(`site-${SLUG}`) ? p('site') : p('backend')
      expect(sh('git', ['-C', repo, 'check-ignore', '-q', f]).code, `${f} ignored`).toBe(0)
    }
    const r = cw(root, ['secrets-check', SLUG])
    expect(r.code, explain(r)).toBe(0)
  })

  it('outward plan: exact gh/vercel commands, A/CNAME only, ISR note, no secret values', () => {
    const md = readFileSync(join(p('record'), 'outward-plan.md'), 'utf8')
    expect(md).toMatch(/gh repo create/)
    expect(md).toMatch(/vercel link/)
    expect(md.split('\n').filter((l) => /(^|\s|\|)(NS|SOA)(\s|\|)/.test(l))).toEqual([])
    expect(md).toMatch(/not needed|ISR/i)
    expect(existsSync(join(p('record'), 'outward-plan.json'))).toBe(true)
  })

  it('fake CRM got each coarse {step,status} exactly once and no lead write', async () => {
    const log = await crmLog(root)
    const pairs = log.provisioningLog.map((e) => `${e.step}:${e.status}`)
    const want = [
      'provisioning-json:ok', 'backend-repo-local:ok', 'backend-seed:ok', 'site-repo-local:ok', 'verify:ok',
      'github-repos:skipped', 'postgres-hosting:skipped', 'vercel-projects:skipped', 'vercel-env:skipped',
      'fallback-dns:skipped', 'deploy-hook:skipped', 'client-dns:skipped', 'dependabot:skipped', 'go-live:skipped',
    ]
    for (const w of want) expect(pairs.filter((x) => x === w), w).toHaveLength(1)
    expect(log.provisioningLog.every((e) => e.key.startsWith(`${st.runId}:`))).toBe(true)
    expect(log.requests.filter((r) => r.path.startsWith('/api/leads') && r.method !== 'GET')).toEqual([])
  })

  it('show-login gives URL, email and the credentials FILE, never the password', () => {
    const r = cw(root, ['show-login', SLUG])
    expect(r.code, explain(r)).toBe(0)
    expect(r.stdout).toContain(REALTOR)
    expect(r.stdout).toContain('.admin-credentials.local')
    const creds = readFileSync(join(p('backend'), '.admin-credentials.local'), 'utf8')
    const pw = creds.match(/^CLIENT_PASSWORD=(.*)$/m)?.[1]
    expect(pw && pw.length >= 8).toBe(true)
    expect(r.stdout + r.stderr).not.toContain(pw!)
  })

  it('a second cw run is a no-op: same commits, credentials, key, CRM log', async () => {
    const heads = [p('record'), p('backend'), p('site')].map((d) => git(d, ['rev-parse', 'HEAD']).trim())
    const creds = fileSha(join(p('backend'), '.admin-credentials.local'))
    const secret = envKeyHash(join(p('backend'), '.env'), 'PAYLOAD_SECRET')
    const before = (await crmLog(root)).provisioningLog.length
    const again = cw(root, ['run', '--lead', '21'])
    expect(again.code, explain(again)).toBe(0)
    const st2 = state(root, SLUG)
    expect(st2.runId).toBe(st.runId)
    expect(st2.ports).toEqual(st.ports)
    expect(st2.siteKey.mintedAt).toBe(st.siteKey.mintedAt)
    expect(st2.steps['backend-credentials'].attempts).toBe(1)
    expect(st2.steps['backend-copy'].attempts).toBe(1)
    expect(st2.steps['site-copy'].attempts).toBe(1)
    expect([p('record'), p('backend'), p('site')].map((d) => git(d, ['rev-parse', 'HEAD']).trim()).slice(1)).toEqual(heads.slice(1))
    expect(fileSha(join(p('backend'), '.admin-credentials.local'))).toBe(creds)
    expect(envKeyHash(join(p('backend'), '.env'), 'PAYLOAD_SECRET')).toBe(secret)
    // keys are <runId>:<name>:<status> and the server dedupes on them: a re-run adds nothing
    const after = (await crmLog(root)).provisioningLog
    expect(after.length, after.map((e) => e.key).join('\n')).toBe(before)
  })

  it('cw status points nowhere (complete) and names no error', () => {
    const r = cw(root, ['status', SLUG])
    expect(r.code, explain(r)).toBe(0)
    expect(JSON.stringify(r.json)).not.toMatch(/"failed"/)
  })

  it('teardown refuses without the matching --confirm-slug, then removes everything local', () => {
    const bad = cw(root, ['teardown', SLUG, '--yes', '--confirm-slug', 'svoboda'])
    expect(bad.code).not.toBe(0)
    expect(existsSync(p('site'))).toBe(true)
    const ok = cw(root, ['teardown', SLUG, '--yes', '--confirm-slug', SLUG])
    expect(ok.code, explain(ok)).toBe(0)
    expect(databases(root)).toEqual([])
    expect(readdirSync(root.clients).filter((d) => d.includes(SLUG))).toEqual([])
    for (const port of [st.ports.site, st.ports.backend]) expect(sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).stdout.trim(), `port ${port}`).toBe('')
  })
})
