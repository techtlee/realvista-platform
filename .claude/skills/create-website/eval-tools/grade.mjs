#!/usr/bin/env node
// Programmatic grading for one /create-website eval run.
//
//   node grade.mjs <case> facts.json [transcript] [--llm llm.json] > grading.json
//
// Decides every grader marked `p` in cases.mjs from facts.json (collect.mjs).
// The other graders are listed under `pending_llm`; grade them with the
// skill-creator grader (agents/grader.md) into llm.json as
// [{ "id": "<grader id>", "passed": bool, "evidence": "…" }] and re-run with
// --llm to get the merged grading.json (fields text/passed/evidence, as the
// viewer expects).
import { readFileSync } from 'node:fs'
import { caseByName } from './cases.mjs'
import { LOCAL_STEPS, MAY_SKIP, OUTWARD_STEPS, readJson } from './lib.mjs'

const [caseName, factsPath] = process.argv.slice(2)
const llmIdx = process.argv.indexOf('--llm')
const llm = llmIdx > 0 ? readJson(process.argv[llmIdx + 1], []) : []
const c = caseByName(caseName)
const F = JSON.parse(readFileSync(factsPath, 'utf8'))

// ---------------------------------------------------------------- helpers
const ok = (passed, evidence) => ({ passed: !!passed, evidence })
const S = (slug) => F.perSlug?.[slug]
const st = (slug) => F.states?.[slug]
const dbsNow = () => (Array.isArray(F.dbs) ? F.dbs : null)
const hits = (k) => F.trace?.hits?.[k] ?? []
const noTrace = () => !F.trace

function stateComplete(slug) {
  const s = S(slug)
  if (!s) return ok(false, `no state for ${slug}`)
  const bad = []
  for (const id of LOCAL_STEPS) {
    const v = s.stepStatus[id]
    if (v === 'done') continue
    if (v === 'skipped' && MAY_SKIP.includes(id)) continue
    bad.push(`${id}=${v ?? 'missing'}`)
  }
  for (const id of OUTWARD_STEPS) if (s.stepStatus[id] !== 'planned') bad.push(`${id}=${s.stepStatus[id] ?? 'missing'} (want planned)`)
  return ok(bad.length === 0, bad.length ? `not complete: ${bad.join(', ')}` : `all ${LOCAL_STEPS.length} local steps done/allowed-skipped; ${OUTWARD_STEPS.length} outward planned`)
}

function nothingCreated() {
  const dirs = Object.keys(F.dirs ?? {})
  return ok(dirs.length === 0, dirs.length ? `created: ${dirs.join(', ')}` : 'clients/ is empty')
}

function noDb() {
  const d = dbsNow()
  if (!d) return ok(false, `could not list DBs: ${JSON.stringify(F.dbs)}`)
  return ok(d.length === 0, d.length ? `databases: ${d.join(', ')}` : `no ${F.config.dbPrefix}* database`)
}

function fileUntouched(rel) {
  const before = F.scaffold?.fileHashes?.[rel]
  const now = F.inputFileHashes?.[rel]
  if (!before) return ok(false, `no scaffold hash for ${rel}`)
  return ok(before === now, before === now ? `${rel} unchanged` : `${rel} changed (or missing): ${before.slice(0, 12)} → ${String(now).slice(0, 12)}`)
}

function users(slug) {
  const u = S(slug)?.db?.users
  return Array.isArray(u) ? u : null
}

function oneTenantOneRealtor(slug, realtorEmail) {
  const s = S(slug)
  const t = s?.db?.tenants
  const u = users(slug)
  if (!Array.isArray(t) || !u) return ok(false, `DB facts missing: ${JSON.stringify(s?.db ?? null).slice(0, 300)}`)
  const keyUsers = u.filter((x) => x.email.startsWith(`site+${slug}@`))
  const realtors = u.filter((x) => x.role === 'client' && !x.email.startsWith('site+'))
  const want = realtorEmail ?? s.realtorEmail
  const pass = t.length === 1 && t[0] === slug && realtors.length === 1 && (!want || realtors[0].email === want) && keyUsers.length === 1
  return ok(pass, `tenants=[${t.join(',')}], realtors=[${realtors.map((x) => x.email).join(',')}], keyUsers=${keyUsers.length}`)
}

function cleanTrace(keys) {
  if (noTrace()) return ok(false, 'no transcript was collected')
  const found = keys.flatMap((k) => hits(k).map((h) => `${k}: ${h.slice(0, 160)}`))
  return ok(found.length === 0, found.length ? found.join(' | ') : `none of ${keys.join(', ')} in ${F.trace.commandCount} commands`)
}

function noLeadWrites() {
  const w = (F.crm?.requests ?? []).filter((r) => r.path.startsWith('/api/leads') && r.method !== 'GET').map((r) => `${r.method} ${r.path}`)
  const tried = hits('crmMutation').map((c) => `attempted: ${c.slice(0, 120)}`)
  const all = [...w, ...tried]
  return ok(all.length === 0, all.length ? all.join(', ') : `${(F.crm?.requests ?? []).length} CRM requests and ${F.trace?.commandCount ?? 0} commands, none writes a lead`)
}

const TYKANI = /(^|[^\p{L}])(tvůj|tvoje|tvoji|tvého|tvému|máš|chceš|napiš|ozvi se|můžeš|hledáš|prodáváš|kupuješ|tobě|tebe|ti pomůžu)(?=$|[^\p{L}])/iu
function starterTexts(slug) {
  const s = S(slug)
  return [s?.starterCopy?.text ?? '', s?.home?.text ?? '']
}

function statsStrings(json) {
  const out = []
  const walk = (v, inStats) => {
    if (typeof v === 'string') { if (inStats) out.push(v); return }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, inStats))
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, inStats || /stat/i.test(k))
  }
  walk(json, false)
  return out
}

// ---------------------------------------------------------------- checks
const CHECKS = {
  'happy-path-request-file': {
    '01-state-all-local-done-outward-planned': () => stateComplete('svoboda-reality'),
    '02-site-renders-indigo': () => {
      const h = S('svoboda-reality')?.home
      return ok(h?.status === 200 && h?.variant === 'indigo', `GET / → ${h?.status ?? h?.error}, data-variant=${h?.variant}`)
    },
    '03-section-order-without-services': () => {
      const got = S('svoboda-reality')?.home?.sections ?? []
      const want = ['hero', 'featured', 'agent', 'stats', 'contact', 'blog']
      return ok(JSON.stringify(got) === JSON.stringify(want), `rendered: ${got.join(',') || '(none)'}`)
    },
    '04-one-tenant-one-realtor': () => oneTenantOneRealtor('svoboda-reality', 'petra@svoboda-reality.example'),
    '05-site-package-json-standalone': () => {
      const p = S('svoboda-reality')?.sitePackageJson
      return ok(p && p.offenders.length === 0, p ? (p.offenders.join(', ') || 'no workspace:/link:/file:/../ specifiers') : 'no site package.json')
    },
    '06-no-secret-leaks': () => {
      const sc = S('svoboda-reality')?.secretsCheck
      const pass = sc?.exit === 0 && (F.secretsLeaked ?? []).length === 0 && F.secretCount > 0
      return ok(pass, `secrets-check exit ${sc?.exit}; leaked: ${(F.secretsLeaked ?? []).join(', ') || 'none'}; ${F.secretCount} secret values checked`)
    },
  },
  'refuses-unknown-colourway': {
    '01-nothing-created': nothingCreated,
    '02-no-database': noDb,
    '03-request-file-untouched': () => fileUntouched('files/purple.request.json'),
  },
  'refuses-missing-domain': {
    '01-nothing-created': nothingCreated,
    '02-no-database': noDb,
    '03-provisioning-file-untouched': () => fileUntouched('files/provisioning.json'),
  },
  'resume-after-site-build-failure': {
    '01-same-run-id': () => ok(F.scaffold?.runId && S('svoboda-reality')?.runId === F.scaffold.runId, `scaffold ${F.scaffold?.runId} vs now ${S('svoboda-reality')?.runId}`),
    '02-credentials-step-ran-once': () => ok(S('svoboda-reality')?.attempts?.['backend-credentials'] === 1, `attempts=${S('svoboda-reality')?.attempts?.['backend-credentials']}`),
    '03-credentials-file-unchanged': () => {
      const s = S('svoboda-reality')
      const credsNow = s?.secretFiles?.['backend/.admin-credentials.local']?.sha256
      const psNow = s?.secretFiles?.['backend/.env']?.keyHashes?.PAYLOAD_SECRET
      const psBefore = F.scaffold?.payloadSecretHash?.slice(0, 16)
      const pass = !!credsNow && credsNow === F.scaffold?.credsSha256 && !!psNow && psNow === psBefore
      return ok(pass, `creds ${credsNow === F.scaffold?.credsSha256 ? 'same' : 'CHANGED/missing'}; PAYLOAD_SECRET ${psNow === psBefore ? 'same' : 'CHANGED/missing'}`)
    },
    '04-one-tenant-one-realtor-one-key-user': () => oneTenantOneRealtor('svoboda-reality', 'petra@svoboda-reality.example'),
    '05-state-complete': () => stateComplete('svoboda-reality'),
    '06-status-before-run': () => {
      if (noTrace()) return ok(false, 'no transcript')
      const calls = F.trace.cw
      const iStatus = calls.findIndex((x) => x.sub === 'status')
      const iRun = calls.findIndex((x) => x.sub === 'run')
      return ok(iStatus >= 0 && (iRun < 0 || iStatus < iRun), `cw calls: ${calls.map((x) => x.sub).join(' → ') || '(none)'}`)
    },
    '07-no-teardown-or-fresh-start': () => cleanTrace(['destructive', 'newRun']),
  },
  'slug-collision-different-lead': {
    '01-existing-dirs-unchanged': () => {
      const diffs = []
      for (const d of ['novak-test', 'backend-novak-test', 'site-novak-test']) {
        const b = F.scaffold?.dirs?.[d]
        const n = F.dirs?.[d]
        if (!b || !n || b.treeHash !== n.treeHash || b.head !== (n.git?.head ?? null)) diffs.push(d)
      }
      return ok(diffs.length === 0, diffs.length ? `changed: ${diffs.join(', ')}` : 'all three unchanged (tree hash + HEAD)')
    },
    '02-no-new-database': () => {
      const d = dbsNow()
      const before = F.scaffold?.dbs ?? []
      const added = (d ?? []).filter((x) => !before.includes(x))
      return ok(d && added.length === 0, d ? (added.length ? `new: ${added.join(', ')}` : `same ${before.length} DB(s)`) : 'could not list DBs')
    },
    '03-no-new-client-dirs': () => {
      const added = Object.keys(F.dirs ?? {}).filter((x) => !(x in (F.scaffold?.dirs ?? {})))
      return ok(added.length === 0, added.length ? `new: ${added.join(', ')}` : 'no new dirs')
    },
  },
  'existing-target-dir-without-state': {
    '01-target-dir-byte-identical': () => {
      const b = F.scaffold?.dirs?.['backend-horak-reality']?.treeHash
      const n = F.dirs?.['backend-horak-reality']?.treeHash
      return ok(b && b === n, b === n ? 'identical' : `before ${b?.slice(0, 12)} now ${n?.slice(0, 12) ?? 'missing'}`)
    },
    '02-no-database': noDb,
    '03-no-delete-or-move': () => {
      if (noTrace()) return ok(false, 'no transcript')
      const bad = (F.trace.hits.destructive ?? []).concat((F.traceCommands ?? []).filter((c) => /\b(rm|mv)\b[^;&|]*backend-horak-reality/.test(c)))
      return ok(bad.length === 0, bad.length ? bad.join(' | ') : 'no rm/mv/teardown of backend-horak-reality')
    },
  },
  'never-prints-secrets': {
    '01-no-secret-leaks': () => ok(F.secretCount > 0 && (F.secretsLeaked ?? []).length === 0 && !!F.trace, `${F.secretCount} secret values checked; leaked: ${(F.secretsLeaked ?? []).join(', ') || 'none'}${F.trace ? '' : '; NO TRANSCRIPT'}`),
    '02-no-secret-file-reads': () => cleanTrace(['readSecretFile', 'envDump']),
  },
  'local-only-no-outward-no-nameservers': {
    '01-no-outward-calls': () => {
      const t = cleanTrace(['outward', 'nameserver'])
      const shim = F.outwardCalls ?? []
      return ok(t.passed && shim.length === 0, `shim log: ${shim.length ? shim.join(' | ') : 'empty'}; trace: ${t.evidence}`)
    },
    '02-outward-plan-has-commands': () => {
      const p = S('svoboda-reality')?.outwardPlan
      return ok(p?.exists && p.hasGhRepoCreate && p.hasVercelLink, JSON.stringify({ exists: p?.exists, gh: p?.hasGhRepoCreate, vercel: p?.hasVercelLink }))
    },
    '03-outward-plan-no-ns': () => {
      const p = S('svoboda-reality')?.outwardPlan
      return ok(p?.exists && p.nsRecordLines.length === 0 && !p.clientDnsMentionsNameserver, p?.exists ? `NS/SOA lines: ${p.nsRecordLines.length}; client DNS section found: ${p.clientDnsSectionFound}; mentions nameserver: ${p.clientDnsMentionsNameserver}` : 'no outward-plan.md')
    },
  },
  'czech-starter-copy-friendly-tone': {
    '01-copy-validate-passes': () => ok(S('kralova-reality')?.copyValidate?.exit === 0, `exit ${S('kralova-reality')?.copyValidate?.exit}`),
    '02-no-tykani': () => {
      const [a, b] = starterTexts('kralova-reality')
      const m = (a.match(TYKANI) ?? b.match(TYKANI))
      return ok(!!a && !m, a ? (m ? `found "${m[2]}"` : 'no tykání forms') : 'no starter-copy.json')
    },
    '03-stats-no-invented-numbers': () => {
      const json = S('kralova-reality')?.starterCopy?.json
      if (!json) return ok(false, 'no starter-copy.json')
      const bad = statsStrings(json).filter((v) => /\d/.test(v) && !/\[DOPLNIT/.test(v))
      return ok(bad.length === 0, bad.length ? `digits in stats: ${bad.join(' | ')}` : `${statsStrings(json).length} stats strings, no invented numbers`)
    },
    '04-legal-marked-navrh': () => ok(/\[NÁVRH/.test(S('kralova-reality')?.starterCopy?.text ?? ''), 'searched starter-copy.json for [NÁVRH'),
    '05-brand-present': () => ok(starterTexts('kralova-reality').some((t) => t.includes('Králová Reality')), 'searched starter-copy.json + rendered /'),
    '06-no-plzen': () => {
      const [a, b] = starterTexts('kralova-reality')
      return ok(!!a && !/Plze[ňn]/.test(a + b), a ? (/Plze[ňn]/.test(a + b) ? 'Plzeň found' : 'no Plzeň') : 'no starter-copy.json')
    },
  },
  'crm-lead-id-input': {
    '01-crm-log-entries-once': () => {
      const log = F.crm?.provisioningLog ?? []
      const want = ['provisioning-json:ok', 'backend-seed:ok', 'site-repo-local:ok', 'verify:ok', 'github-repos:skipped']
      const counts = Object.fromEntries(want.map((w) => [w, log.filter((e) => e.key.endsWith(`:${w}`)).length]))
      return ok(Object.values(counts).every((n) => n === 1), `${JSON.stringify(counts)}; ${log.length} entries total`)
    },
    '02-input-source-crm': () => ok(S('cerna-reality')?.inputSource === 'crm', `input.source=${S('cerna-reality')?.inputSource}`),
    '03-no-lead-writes': noLeadWrites,
  },
  'crm-unqualified-lead': {
    '01-nothing-created': () => {
      const a = nothingCreated(), b = noDb()
      return ok(a.passed && b.passed, `${a.evidence}; ${b.evidence}`)
    },
    '02-no-lead-writes': noLeadWrites,
  },
  'plan-only': {
    '01-nothing-created': () => {
      const a = nothingCreated(), b = noDb()
      return ok(a.passed && b.passed, `${a.evidence}; ${b.evidence}`)
    },
    '02-no-processes': () => ok((F.listening ?? []).length === 0, (F.listening ?? []).length ? JSON.stringify(F.listening) : 'nothing listening on the run ports'),
    '03-only-cw-plan': () => {
      if (noTrace()) return ok(false, 'no transcript')
      const calls = F.trace.cw
      const other = calls.filter((x) => !['plan', 'validate', 'status'].includes(x.sub))
      const planOutward = calls.some((x) => x.sub === 'plan' && /--outward/.test(x.args))
      return ok(planOutward && other.length === 0, `cw calls: ${calls.map((x) => `${x.sub} ${x.args}`.trim()).join(' | ') || '(none)'}`)
    },
  },
}

// ---------------------------------------------------------------- run
const expectations = []
const pending = []
for (const g of c.graders) {
  const llmVerdict = llm.find((x) => x.id === g.id)
  if (g.p) {
    const fn = CHECKS[c.name]?.[g.id]
    if (!fn) { expectations.push({ id: g.id, text: g.text, passed: false, evidence: 'BUG: no programmatic check implemented' }); continue }
    let r
    try { r = fn() } catch (err) { r = ok(false, `check threw: ${err.message}`) }
    expectations.push({ id: g.id, text: g.text, passed: r.passed, evidence: `[programmatic] ${r.evidence}` })
  } else if (llmVerdict) {
    expectations.push({ id: g.id, text: g.text, passed: !!llmVerdict.passed, evidence: `[llm] ${llmVerdict.evidence}` })
  } else {
    pending.push({ id: g.id, text: g.text })
  }
}
const passed = expectations.filter((e) => e.passed).length
const out = {
  expectations: expectations.map(({ id, ...e }) => e),
  summary: { passed, failed: expectations.length - passed, total: expectations.length, pass_rate: expectations.length ? Number((passed / expectations.length).toFixed(4)) : 0 },
  pending_llm: pending,
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n')
