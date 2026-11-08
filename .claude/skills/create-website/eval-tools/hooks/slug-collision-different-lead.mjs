// Case 5 scaffold: a complete, earlier novak-test provisioning made from a
// DIFFERENT request (client #1, lead 1) — record repo with state, backend and
// site repos with their template trailers, and its database. The new request
// (novak2, lead 31) asks for the same slug.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLATFORM_DEFAULT, sh, sha256 } from '../lib.mjs'

const LOCAL = ['preflight', 'input', 'crm-site-record', 'record-repo', 'backend-copy', 'backend-customize', 'backend-install', 'backend-db', 'backend-env', 'backend-credentials', 'backend-migrate', 'backend-seed-admin', 'starter-copy', 'backend-seed-content', 'backend-seed-realtor', 'backend-start', 'site-key', 'site-copy', 'site-standalone', 'site-env', 'site-install', 'site-build', 'site-start', 'verify', 'crm-report']
const OUTWARD = ['github-repos', 'postgres-hosting', 'vercel-projects', 'vercel-env', 'fallback-domains', 'deploy-hook', 'client-dns', 'dependabot-enable', 'go-live']

function git(dir, files, subject, trailers) {
  sh('git', ['init', '-q', '-b', 'main', dir])
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c) }
  sh('git', ['-C', dir, 'add', '-A'])
  const msg = `${subject}\n\n${trailers.join('\n')}\n`
  const r = sh('git', ['-C', dir, '-c', 'user.name=cw-eval', '-c', 'user.email=cw-eval@example.invalid', 'commit', '-q', '-m', msg])
  if (r.code !== 0) throw new Error(r.stderr)
}

export default async function ({ run, cfg }) {
  const fixtures = join(PLATFORM_DEFAULT, 'tools', 'create-website', 'fixtures', 'requests')
  const reqText = readFileSync(join(fixtures, 'novak-test.request.json'), 'utf8')
  const req = JSON.parse(reqText)
  const clients = join(run, 'clients')
  const runId = 'cw-20261101T090000Z-a1b2'
  const at = '2026-11-01T09:30:00.000Z'
  const dbName = `${cfg.dbPrefix}backend_novak_test_dev`
  const sitePort = cfg.ports.site[1]
  const backendPort = cfg.ports.backend[1]
  const steps = {}
  for (const s of LOCAL) steps[s] = { status: s === 'crm-site-record' || s === 'crm-report' ? 'skipped' : 'done', attempts: 1, fingerprint: `sha256:${sha256(s + runId)}`, startedAt: at, finishedAt: at, outputs: {}, error: null }
  for (const s of OUTWARD) steps[s] = { status: 'planned', attempts: 0, note: 'local mode; plan in outward-plan.md' }
  steps['outward-plan'] = { status: 'done', attempts: 1, startedAt: at, finishedAt: at }
  steps.handover = { status: 'done', attempts: 1, startedAt: at, finishedAt: at }
  const state = {
    stateVersion: 1, toolVersion: '0.1.0', runId, slug: 'novak-test', mode: 'local', createdAt: at, updatedAt: at,
    input: { source: 'file', path: join(run, 'files', 'novak-test.request.json'), requestSha256: sha256(reqText), provisioningSha256: sha256(JSON.stringify(req.provisioning)) },
    templates: { platform: { repo: cfg.platformRepo, commit: '8f50541' }, cms: { repo: cfg.cmsRepo, commit: '1f5a756', templateApiVersion: 1 } },
    paths: { record: join(clients, 'novak-test'), backend: join(clients, 'backend-novak-test'), site: join(clients, 'site-novak-test') },
    ports: { site: sitePort, backend: backendPort },
    db: { name: dbName, host: 'localhost', port: 5432, createdByRun: runId },
    tenantId: 1, siteKey: { mintedAt: at, verifiedAt: at },
    secrets: { 'backend/.env': ['DATABASE_URL', 'PAYLOAD_SECRET', 'PORT', 'PLATFORM_SUBDOMAIN_BASE'], 'site/.env.local': ['NEXT_PUBLIC_CMS_URL', 'TENANT_ID', 'CMS_API_KEY', 'REVALIDATE_SECRET'] },
    steps, processes: { backend: null, site: null },
    verify: [{ check: 'section-order', ok: true, detail: 'hero,agent,featured,stats,services,blog,contact' }],
    crmOutbox: [],
  }
  git(join(clients, 'novak-test'), {
    'provisioning-request.json': reqText,
    'provisioning.json': JSON.stringify(req.provisioning, null, 2) + '\n',
    'create-website.state.json': JSON.stringify(state, null, 2) + '\n',
    '.gitignore': 'logs/\n.create-website.lock\n',
  }, 'Provisioning request for novak-test', ['Create-Website-Step: record-repo'])
  git(join(clients, 'backend-novak-test'), { 'README.md': '# backend-novak-test\n\nJan Novák Reality — client CMS.\n', 'package.json': '{ "name": "backend-novak-test", "private": true }\n', '.gitignore': '.env\n.admin-credentials.local\nnode_modules/\n' },
    'Copy of realvista-client-backend template (cms 1f5a756)', ['Create-Website-Template: cms@1f5a756'])
  git(join(clients, 'site-novak-test'), { 'README.md': '# site-novak-test\n', 'package.json': '{ "name": "site-novak-test", "private": true }\n', '.gitignore': '.env.local\nnode_modules/\n.next/\n' },
    'Copy of the REALVISTA site template (platform 8f50541)', ['Create-Website-Template: platform@8f50541'])
  const r = sh('psql', ['-h', 'localhost', '-d', 'postgres', '-AtX', '-c', `create database "${dbName}"`])
  if (r.code !== 0 && !/already exists/.test(r.stderr)) throw new Error(r.stderr)
  writeFileSync(join(clients, '.create-website-ports.json'), JSON.stringify({ 'novak-test': { site: sitePort, backend: backendPort } }, null, 2) + '\n')
  return { existingRunId: runId, existingDb: dbName }
}
