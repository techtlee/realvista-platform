// Teardown of one eval/e2e run cwd: stop the client processes, the fake CRM,
// drop the run's DBs (only its own dbPrefix, which must start cweval_/cwtest_),
// then remove the cwd. Usable as a module or: node teardown.mjs <runCwd> [--keep]
import { existsSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { PLATFORM_DEFAULT, readJson, sh } from './lib.mjs'

const RESERVED = new Set([3000, 3001, 3003, 3004, 3017, 3027, 3029])

function isTmp(p) {
  const roots = [tmpdir(), '/tmp', '/private/tmp', '/private/var/folders', '/var/folders'].map((r) => { try { return realpathSync(r) } catch { return r } })
  const real = (() => { try { return realpathSync(p) } catch { return resolve(p) } })()
  return roots.some((r) => real.startsWith(r + '/'))
}

function killPid(pid) {
  try { process.kill(-pid, 'SIGTERM') } catch {}
  try { process.kill(pid, 'SIGTERM') } catch {}
}

export function teardownRun(runCwd, { keep = false, platform = process.env.CW_EVAL_PLATFORM ?? PLATFORM_DEFAULT } = {}) {
  runCwd = resolve(runCwd)
  if (!isTmp(runCwd)) throw new Error(`teardown: refusing ${runCwd} (not under a temp dir)`)
  const cfg = readJson(join(runCwd, 'create-website.config.json'), {})
  const clients = resolve(runCwd, cfg.clientsDir ?? './clients')
  if (clients.includes('/Makleri/clients')) throw new Error('teardown: clientsDir is the real Makleri/clients; refusing')
  const cw = join(platform, 'tools', 'create-website', 'bin', 'cw')

  // 1. cw stop for every slug with a state, then any pid still on the run's ports
  if (existsSync(clients)) for (const d of readdirSync(clients)) {
    if (existsSync(join(clients, d, 'create-website.state.json')) && existsSync(cw)) sh(cw, ['stop', d, '--json'], { cwd: runCwd, timeoutMs: 60_000 })
  }
  for (const [a, b] of [cfg.ports?.site, cfg.ports?.backend].filter(Boolean)) for (let p = a; p <= b; p++) {
    if (RESERVED.has(p)) continue
    for (const pid of sh('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN', '-t']).stdout.split('\n').filter(Boolean)) killPid(Number(pid))
  }
  // processes whose cwd is inside the run (next dev/start children, stray servers)
  const lsof = sh('lsof', ['-a', '-d', 'cwd', '-Fpn', '+D', runCwd], { timeoutMs: 30_000 }).stdout
  for (const m of lsof.matchAll(/^p(\d+)$/gm)) if (Number(m[1]) !== process.pid) killPid(Number(m[1]))

  // 2. fake CRM
  const crmPid = existsSync(join(runCwd, '.fake-crm', 'pid')) ? Number(readFileSync(join(runCwd, '.fake-crm', 'pid'), 'utf8')) : null
  if (crmPid) killPid(crmPid)

  // 3. DBs with this run's prefix only
  const prefix = cfg.dbPrefix ?? ''
  const dropped = []
  if (/^(cweval|cwtest)_[a-z0-9_]+_$/.test(prefix)) {
    const like = prefix.replace(/[_%\\]/g, (c) => '\\' + c) + '%'
    const dbs = sh('psql', ['-h', 'localhost', '-d', 'postgres', '-AtX', '-c', `select datname from pg_database where datname like '${like}'`]).stdout.split('\n').filter(Boolean)
    for (const db of dbs) {
      sh('psql', ['-h', 'localhost', '-d', 'postgres', '-AtX', '-c', `select pg_terminate_backend(pid) from pg_stat_activity where datname='${db}'`])
      const r = sh('psql', ['-h', 'localhost', '-d', 'postgres', '-AtX', '-c', `drop database if exists "${db}"`])
      if (r.code === 0) dropped.push(db)
    }
  }

  // 4. the cwd
  if (!keep) rmSync(runCwd, { recursive: true, force: true })
  return { dropped }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = teardownRun(process.argv[2], { keep: process.argv.includes('--keep') })
  console.log(JSON.stringify(r))
}
