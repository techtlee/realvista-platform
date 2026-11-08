#!/usr/bin/env node
// Sweep leftovers of /create-website e2e tests and evals (design §B "Teardown").
//
//   node tools/create-website/scripts/cleanup-test-resources.mjs [--max-age-min 120] [--all] [--dry-run]
//
// Removes, when older than --max-age-min (default 120; --all ignores age):
// - Postgres DBs named cwtest_% or cweval_% (nothing else, ever)
// - processes LISTENING on 4100–4699 whose cwd is under $TMPDIR/cw-*
//   (never the reserved dev ports 3000/3001/3003/3004/3017/3027/3029)
// - temp roots $TMPDIR/cw-e2e-* and $TMPDIR/cw-eval-*
// Refuses any path outside $TMPDIR, and any temp root whose create-website.config.json
// points clientsDir at the real Makleri/clients.
import { existsSync, readdirSync, realpathSync, rmSync, statSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const all = argv.includes('--all')
const dry = argv.includes('--dry-run')
const maxAgeMin = Number(argv[argv.indexOf('--max-age-min') + 1] || 120)
const cutoff = Date.now() - maxAgeMin * 60_000
const TMP = realpathSync(tmpdir())
const RESERVED = new Set([3000, 3001, 3003, 3004, 3017, 3027, 3029])
const report = { dbs: [], processes: [], dirs: [], refused: [] }

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000 })
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }
}
const psql = (q) => sh('psql', ['-h', 'localhost', '-d', 'postgres', '-AtX', '-F', '\t', '-c', q])
const underTmp = (p) => { try { return realpathSync(p).startsWith(TMP + '/') } catch { return false } }

// --- databases ------------------------------------------------------------------
const list = psql(`select datname, oid from pg_database where datname like 'cwtest\\_%' or datname like 'cweval\\_%'`)
for (const line of list.out.split('\n').filter(Boolean)) {
  const [name, oid] = line.split('\t')
  if (!/^(cwtest|cweval)_[a-z0-9_]+$/.test(name)) { report.refused.push(`db ${name}`); continue }
  let old = all
  if (!all) {
    const age = psql(`select extract(epoch from (pg_stat_file('base/${oid}/PG_VERSION')).modification)`)
    old = age.code === 0 ? Number(age.out.trim()) * 1000 < cutoff : false // unknown age → keep (use --all)
  }
  if (!old) continue
  if (!dry) {
    psql(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${name}'`)
    const r = psql(`drop database if exists "${name}"`)
    if (r.code !== 0) { report.refused.push(`db ${name}: ${r.err.trim()}`); continue }
  }
  report.dbs.push(name)
}

// --- processes --------------------------------------------------------------------
const lsof = sh('lsof', ['-nP', '-iTCP:4100-4699', '-sTCP:LISTEN', '-Fpn'])
const pids = new Map()
let cur = null
for (const l of lsof.out.split('\n')) {
  if (l.startsWith('p')) cur = Number(l.slice(1))
  if (l.startsWith('n') && cur) {
    const port = Number(l.split(':').pop())
    if (!RESERVED.has(port)) pids.set(cur, port)
  }
}
for (const [pid, port] of pids) {
  const cwd = sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).out.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? ''
  if (!cwd || !underTmp(cwd) || !/\/cw-(e2e|eval)-/.test(cwd)) continue
  if (!dry) { try { process.kill(pid, 'SIGTERM') } catch {} }
  report.processes.push({ pid, port, cwd })
}

// --- temp roots ---------------------------------------------------------------------
for (const name of readdirSync(TMP)) {
  if (!/^cw-(e2e|eval)-/.test(name)) continue
  const p = join(TMP, name)
  if (!underTmp(p)) { report.refused.push(p); continue }
  const cfgPath = join(p, 'create-website.config.json')
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      if (resolve(p, cfg.clientsDir ?? '.').includes('/Makleri/clients')) { report.refused.push(`${p}: clientsDir is the real Makleri/clients`); continue }
    } catch {}
  }
  if (!all && statSync(p).mtimeMs > cutoff) continue
  if (!dry) rmSync(p, { recursive: true, force: true })
  report.dirs.push(p)
}

console.log(JSON.stringify({ dryRun: dry, maxAgeMin: all ? 'any' : maxAgeMin, ...report }, null, 2))
