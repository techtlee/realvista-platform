#!/usr/bin/env node
// Per-run scaffold for a /create-website eval case. Called by evals/<case>/place-files.sh
// with the run's cwd as the current directory.
//
//   CW_EVAL_SLOT=0|1  CW_EVAL_PLATFORM=…  CW_EVAL_CMS=…  CW_EVAL_CMS_REF=main  node scaffold.mjs <caseDir>
//
// 1. copies the case's files/ into ./files (the prompts say files/<name>), moves
//    files/create-website.config.json to ./ and files/bin to ./bin
// 2. fills the config: absolute platform/cms paths; slot 1 (the baseline run of
//    the same case) gets its own ports, dbPrefix and CRM port so both configs can
//    run at the same time
// 3. starts the fake CRM (pid in .fake-crm/pid) and waits for it
// 4. runs the case hook (eval-tools/hooks/<hook>) if the case has one
// 5. writes .scaffold.json: DBs, client dir hashes, input file hashes (+ hook extras)
//
// Refuses to run anywhere but under $TMPDIR (or /tmp, /private/var/folders), and
// refuses a clientsDir that resolves to the real Makleri/clients.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { caseByName } from './cases.mjs'
import { EVAL_TOOLS, PLATFORM_DEFAULT, gitFacts, portsFor, sh, sha256, treeHash } from './lib.mjs'

const caseDir = resolve(process.argv[2] ?? '.')
const c = caseByName(basename(caseDir))
const run = realpathSync(process.cwd())
const slot = Number(process.env.CW_EVAL_SLOT ?? 0)

const tmpRoots = [tmpdir(), '/tmp', '/private/tmp', '/private/var/folders', '/var/folders'].map((p) => { try { return realpathSync(p) } catch { return p } })
if (!process.env.CW_EVAL_ALLOW_CWD && !tmpRoots.some((r) => run.startsWith(r + '/'))) {
  console.error(`scaffold: refusing to scaffold into ${run} (not under a temp dir). Set CW_EVAL_ALLOW_CWD=1 inside a sandbox.`)
  process.exit(4)
}

const platform = resolve(process.env.CW_EVAL_PLATFORM ?? PLATFORM_DEFAULT)
const cmsGuess = [join(platform, '..', 'cms'), join(platform, '..', '..', 'cms')].find((p) => existsSync(join(p, 'package.json')))
const cms = resolve(process.env.CW_EVAL_CMS ?? cmsGuess ?? join(platform, '..', 'cms'))
const cmsRef = process.env.CW_EVAL_CMS_REF ?? 'main'

// 1. files
mkdirSync(join(run, 'files'), { recursive: true })
cpSync(join(caseDir, 'files'), join(run, 'files'), { recursive: true })
renameSync(join(run, 'files', 'create-website.config.json'), join(run, 'create-website.config.json'))
if (existsSync(join(run, 'files', 'bin'))) {
  rmSync(join(run, 'bin'), { recursive: true, force: true })
  renameSync(join(run, 'files', 'bin'), join(run, 'bin'))
}
const crmData = join(run, 'files', 'fake-crm.json')
const crmDataHidden = join(run, '.fake-crm.json')
renameSync(crmData, crmDataHidden) // not an input file for the prompt

// 2. config
const ports = portsFor(c.no, slot)
const cfgPath = join(run, 'create-website.config.json')
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
cfg.platformRepo = platform
cfg.cmsRepo = cms
cfg.cmsRef = cmsRef
cfg.dbPrefix = `cweval_${String(c.no).padStart(2, '0')}_${slot}_`
cfg.ports.site = ports.site
cfg.ports.backend = ports.backend
cfg.crm.url = `http://127.0.0.1:${ports.crm}`
cfg.testMode = true
const realClients = resolve(platform, '..', 'clients')
if (resolve(run, cfg.clientsDir) === realClients || resolve(run, cfg.clientsDir).includes('/Makleri/clients')) {
  console.error('scaffold: clientsDir resolves to the real Makleri/clients; refusing')
  process.exit(4)
}
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
mkdirSync(join(run, 'clients'), { recursive: true })

// 3. fake CRM
const crmDir = join(run, '.fake-crm')
mkdirSync(crmDir, { recursive: true })
const out = openSync(join(crmDir, 'server.log'), 'a')
const child = spawn(process.execPath, [join(EVAL_TOOLS, 'fake-crm.mjs'), '--port', String(ports.crm), '--data', crmDataHidden, '--dir', crmDir], { detached: true, stdio: ['ignore', out, out] })
child.unref()
let up = false
for (let i = 0; i < 50 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${ports.crm}/__health`)).ok } catch { await new Promise((r) => setTimeout(r, 100)) }
}
if (!up) { console.error(`scaffold: fake CRM did not come up on ${ports.crm} (port busy?)`); process.exit(4) }

// 4. hook
const extras = {}
if (c.hook) {
  const hook = await import(join(EVAL_TOOLS, 'hooks', c.hook))
  Object.assign(extras, (await hook.default({ run, cfg, platform, cms, caseDef: c, slot })) ?? {})
}

// 5. snapshot
const like = cfg.dbPrefix.replace(/[_%\\]/g, (ch) => '\\' + ch) + '%'
const dbs = sh('psql', ['-h', 'localhost', '-d', 'postgres', '-AtX', '-c', `select datname from pg_database where datname like '${like}' order by 1`]).stdout.split('\n').filter(Boolean)
const clientsDir = join(run, 'clients')
const dirs = Object.fromEntries(readdirSync(clientsDir).filter((n) => statSync(join(clientsDir, n)).isDirectory()).map((n) => [n, { treeHash: treeHash(join(clientsDir, n)), head: gitFacts(join(clientsDir, n))?.head ?? null }]))
const fileHashes = Object.fromEntries(readdirSync(join(run, 'files')).filter((n) => statSync(join(run, 'files', n)).isFile()).map((n) => [`files/${n}`, sha256(readFileSync(join(run, 'files', n)))]))
writeFileSync(join(run, '.scaffold.json'), JSON.stringify({ case: c.name, slot, at: new Date().toISOString(), ports, dbPrefix: cfg.dbPrefix, dbs, dirs, fileHashes, ...extras }, null, 2) + '\n')
console.log(`scaffolded ${c.name} (slot ${slot}) in ${run}`)
