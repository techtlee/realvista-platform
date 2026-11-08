#!/usr/bin/env node
// Collect the facts the programmatic graders decide on, from one eval run's cwd.
// Run it after the run and BEFORE teardown (it reads secret files, DBs, ports).
//
//   node collect.mjs <runCwd> [--transcript t.jsonl] [--outputs dir] [--final final.md] > facts.json
//
// Secret VALUES never leave this process: facts carry names, hashes and booleans only.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  FORBIDDEN, OUTWARD_STEPS, PLATFORM_DEFAULT, cwCalls, findLeaks, gitFacts, listFilesRec,
  nonBashSecretReads, parseEnvFile, parseTranscript, readJson, secretValues, sh, sha256, treeHash,
} from './lib.mjs'

const argv = process.argv.slice(2)
const runCwd = resolve(argv[0] ?? '.')
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const platform = process.env.CW_EVAL_PLATFORM ?? PLATFORM_DEFAULT
const cwBin = join(platform, 'tools', 'create-website', 'bin', 'cw')

const cfg = readJson(join(runCwd, 'create-website.config.json'), {})
const clientsDir = resolve(runCwd, cfg.clientsDir ?? './clients')
const dbPrefix = cfg.dbPrefix ?? ''

const facts = { runCwd, collectedAt: new Date().toISOString(), config: { clientsDir, dbPrefix, ports: cfg.ports ?? null, crm: cfg.crm?.url ?? null } }

// --- directories under clientsDir --------------------------------------------
facts.dirs = {}
if (existsSync(clientsDir)) {
  for (const name of readdirSync(clientsDir)) {
    const p = join(clientsDir, name)
    if (!statSync(p).isDirectory()) continue
    facts.dirs[name] = { treeHash: treeHash(p), git: gitFacts(p) }
  }
}
facts.siteDirs = Object.keys(facts.dirs).filter((d) => d.startsWith('site-'))
facts.backendDirs = Object.keys(facts.dirs).filter((d) => d.startsWith('backend-'))

// --- databases ----------------------------------------------------------------
const pgHost = cfg.postgres?.host ?? 'localhost'
const pgPort = String(cfg.postgres?.port ?? 5432)
const psql = (db, q) => sh('psql', ['-h', pgHost, '-p', pgPort, '-d', db, '-AtX', '-F', '\t', '-c', q], { timeoutMs: 20_000 })
if (dbPrefix) {
  const like = dbPrefix.replace(/[_%\\]/g, (c) => '\\' + c) + '%'
  const r = psql('postgres', `select datname from pg_database where datname like '${like}' order by 1`)
  facts.dbs = r.code === 0 ? r.stdout.split('\n').filter(Boolean) : { error: r.stderr.trim() }
} else facts.dbs = { error: 'no dbPrefix in config: refusing to list DBs' }

// --- state files, per slug ----------------------------------------------------
facts.states = {}
facts.perSlug = {}
for (const name of Object.keys(facts.dirs)) {
  const statePath = join(clientsDir, name, 'create-website.state.json')
  if (!existsSync(statePath)) continue
  const st = readJson(statePath)
  if (!st) { facts.states[name] = { unreadable: true }; continue }
  facts.states[st.slug ?? name] = st
}

for (const [slug, st] of Object.entries(facts.states)) {
  if (st.unreadable) continue
  const f = (facts.perSlug[slug] = {})
  const steps = st.steps ?? {}
  f.stepStatus = Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v.status]))
  f.attempts = Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v.attempts]))
  f.runId = st.runId
  f.inputSource = st.input?.source
  f.requestSha256 = st.input?.requestSha256
  f.ports = st.ports
  f.dbName = st.db?.name
  f.siteKeyMintedAt = st.siteKey?.mintedAt ?? null
  f.verify = st.verify ?? []
  f.outwardStatuses = Object.fromEntries(OUTWARD_STEPS.map((s) => [s, steps[s]?.status ?? null]))

  // secret files: existence, mode, hashes (never values)
  f.secretFiles = {}
  for (const [repo, file] of [['backend', '.env'], ['backend', '.admin-credentials.local'], ['site', '.env.local']]) {
    const p = join(clientsDir, `${repo}-${slug}`, file)
    if (!existsSync(p)) { f.secretFiles[`${repo}/${file}`] = null; continue }
    const env = parseEnvFile(p)
    f.secretFiles[`${repo}/${file}`] = {
      mode: (statSync(p).mode & 0o777).toString(8),
      sha256: sha256(readFileSync(p)),
      keys: Object.keys(env),
      keyHashes: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, sha256(v).slice(0, 16)])),
    }
  }
  const creds = parseEnvFile(join(clientsDir, `backend-${slug}`, '.admin-credentials.local'))
  f.realtorEmail = creds.CLIENT_EMAIL ?? null

  // tenants / users in the backend DB
  if (f.dbName) {
    const t = psql(f.dbName, 'select slug from tenants order by id')
    const u = psql(f.dbName, 'select email, platform_role from users order by id')
    f.db = {
      exists: Array.isArray(facts.dbs) && facts.dbs.includes(f.dbName),
      tenants: t.code === 0 ? t.stdout.split('\n').filter(Boolean) : { error: t.stderr.trim().slice(0, 300) },
      users: u.code === 0 ? u.stdout.split('\n').filter(Boolean).map((l) => { const [email, role] = l.split('\t'); return { email, role } }) : { error: u.stderr.trim().slice(0, 300) },
    }
  }

  // site package.json
  const pkgPath = join(clientsDir, `site-${slug}`, 'package.json')
  if (existsSync(pkgPath)) {
    const txt = readFileSync(pkgPath, 'utf8')
    f.sitePackageJson = { offenders: [...txt.matchAll(/"[^"]*":\s*"((?:workspace:|link:|file:|\.\.\/)[^"]*)"/g)].map((m) => m[0]) }
  }

  // the running site: data-variant + data-section order
  const sitePort = st.ports?.site
  if (sitePort) {
    try {
      const res = await fetch(`http://127.0.0.1:${sitePort}/`, { signal: AbortSignal.timeout(20_000) })
      const html = await res.text()
      const sections = []
      for (const m of html.matchAll(/data-section="([^"]+)"/g)) if (!sections.includes(m[1])) sections.push(m[1])
      const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      f.home = { status: res.status, variant: html.match(/<html[^>]*\sdata-variant="([^"]+)"/)?.[1] ?? null, sections, text: text.slice(0, 20000) }
    } catch (err) {
      f.home = { error: String(err.message ?? err) }
    }
  }

  // starter copy
  const scPath = join(clientsDir, slug, 'starter-copy.json')
  if (existsSync(scPath)) f.starterCopy = { text: readFileSync(scPath, 'utf8'), json: readJson(scPath) }

  // outward plan
  const planPath = join(clientsDir, slug, 'outward-plan.md')
  if (existsSync(planPath)) {
    const md = readFileSync(planPath, 'utf8')
    const clientDns = md.split(/\n(?=#{1,4}\s)/).filter((s) => /client[- ]dns|DNS (u )?klienta|client's DNS/i.test(s.split('\n')[0])).join('\n')
    f.outwardPlan = {
      exists: true,
      hasGhRepoCreate: /gh repo create/.test(md),
      hasVercelLink: /vercel link/.test(md),
      nsRecordLines: md.split('\n').filter((l) => /(^|\s|\|)(NS|SOA)(\s|\|)/.test(l)),
      clientDnsMentionsNameserver: /nameserver/i.test(clientDns),
      clientDnsSectionFound: clientDns.length > 0,
      deployHookNotNeeded: /not needed|ISR/i.test(md),
    }
  } else f.outwardPlan = { exists: false }

  // CLI checks that do not print secrets
  if (existsSync(cwBin)) {
    const sc = sh(cwBin, ['secrets-check', slug, '--json'], { cwd: runCwd, timeoutMs: 120_000 })
    f.secretsCheck = { exit: sc.code, json: readJsonSafe(sc.stdout) }
    if (f.starterCopy) {
      const cv = sh(cwBin, ['copy', 'validate', slug, '--json'], { cwd: runCwd, timeoutMs: 60_000 })
      f.copyValidate = { exit: cv.code, json: readJsonSafe(cv.stdout) }
    }
  }
}

function readJsonSafe(s) { try { return JSON.parse(s) } catch { return { unparsed: s.slice(0, 500) } } }

// --- fake CRM -----------------------------------------------------------------
const crmDir = join(runCwd, '.fake-crm')
const jsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
facts.crm = { requests: jsonl(join(crmDir, 'requests.jsonl')), provisioningLog: jsonl(join(crmDir, 'provisioning-log.jsonl')) }

// --- PATH shims -----------------------------------------------------------------
const oc = join(runCwd, 'outward-calls.log')
facts.outwardCalls = existsSync(oc) ? readFileSync(oc, 'utf8').split('\n').filter(Boolean) : []

// --- processes listening on this run's ports ------------------------------------
facts.listening = []
const ranges = [cfg.ports?.site, cfg.ports?.backend].filter(Boolean)
for (const [a, b] of ranges) for (let p = a; p <= b; p++) {
  const r = sh('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN', '-t'], { timeoutMs: 10_000 })
  if (r.stdout.trim()) facts.listening.push({ port: p, pids: r.stdout.trim().split('\n') })
}

// --- scaffold snapshot + input files ------------------------------------------------
facts.scaffold = readJson(join(runCwd, '.scaffold.json'), null)
facts.inputFileHashes = {}
if (existsSync(join(runCwd, 'files'))) for (const n of readdirSync(join(runCwd, 'files'))) {
  const p = join(runCwd, 'files', n)
  if (statSync(p).isFile()) facts.inputFileHashes[`files/${n}`] = sha256(readFileSync(p))
}

// --- transcript: forbidden commands + secret leaks ---------------------------------
const transcriptPath = opt('transcript')
const texts = []
if (transcriptPath && existsSync(transcriptPath)) {
  const t = parseTranscript(readFileSync(transcriptPath, 'utf8'))
  texts.push(t.raw, t.final)
  facts.trace = { commandCount: t.commands.length, hits: {}, cw: cwCalls(t.commands).map(({ sub, args }) => ({ sub, args })) }
  facts.traceCommands = t.commands.map((c) => c.slice(0, 400))
  for (const [k, re] of Object.entries(FORBIDDEN)) facts.trace.hits[k] = t.commands.filter((c) => re.test(c))
  facts.trace.hits.readSecretFile.push(...nonBashSecretReads(t))
  facts.trace.skillUsed = t.tools.some((x) => x.name === 'Skill' && /create-website/.test(JSON.stringify(x.input)))
  facts.finalMessage = t.final.slice(0, 20000)
}
if (opt('final') && existsSync(opt('final'))) texts.push(readFileSync(opt('final'), 'utf8'))
if (opt('outputs')) for (const p of listFilesRec(resolve(opt('outputs')))) {
  if (/facts\.json$/.test(p)) continue
  try { texts.push(readFileSync(p, 'utf8')) } catch {}
}
// logs, state and the plan also must not carry values (design A5)
for (const slug of Object.keys(facts.states)) {
  for (const p of listFilesRec(join(clientsDir, slug)).filter((p) => !/\/\.git\//.test(p))) {
    try { texts.push(readFileSync(p, 'utf8')) } catch {}
  }
}
const secrets = Object.keys(facts.states).flatMap((slug) => secretValues(clientsDir, slug))
facts.secretCount = secrets.length
facts.secretsLeaked = findLeaks(secrets, texts)

process.stdout.write(JSON.stringify(facts, null, 2) + '\n')
