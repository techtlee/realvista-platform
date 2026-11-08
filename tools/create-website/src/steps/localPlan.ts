/**
 * What each LOCAL step would execute, for `cw plan` (never executed from
 * here). Secrets appear as env NAMES only; values never enter a plan.
 */
import type { Ctx, PlannedCommand, StepId } from '../types.js'
import { dbName } from '../dbname.js'

const c = (id: string, description: string, argv: string[], envNames: string[] = [], note?: string): PlannedCommand => ({
  id,
  description,
  argv,
  envNames,
  ...(note ? { note } : {}),
})

export const LOCAL_PLANS: Partial<Record<StepId, (ctx: Ctx) => PlannedCommand[]>> = {
  preflight: () => [c('tools', 'node ≥ 22, pnpm, git, Postgres reachable, template manifests, ports free', ['pnpm', '--version'])],
  input: (ctx) => [c('write', `write clients/${ctx.request.slug}/provisioning-request.json + provisioning.json`, [])],
  'record-repo': (ctx) => [c('git', `git init clients/${ctx.request.slug}; commit the request`, ['git', 'init', '-b', 'main'])],
  'backend-copy': (ctx) => [
    c('archive', `git archive ${ctx.cfg.cmsRef}@<pinned sha> of the cms template into backend-${ctx.request.slug} (temp dir + rename)`, ['git', 'archive', '--format=tar', '<sha>']),
  ],
  'backend-customize': () => [c('files', 'client README.md + .github/dependabot.yml; commit', [])],
  'backend-install': () => [c('install', 'install backend dependencies', ['pnpm', 'install', '--frozen-lockfile'])],
  'backend-db': (ctx) => [c('createdb', `CREATE DATABASE ${dbName(ctx.request.slug, ctx.cfg.dbPrefix)}`, [])],
  'backend-env': () => [c('env', '.env (0600): only missing keys are added', [], ['DATABASE_URL', 'PAYLOAD_SECRET', 'PORT', 'PLATFORM_SUBDOMAIN_BASE'])],
  'backend-credentials': () => [
    c('creds', '.admin-credentials.local (0600), generated once, never regenerated', [], ['MAKLERI_ADMIN_EMAIL', 'MAKLERI_ADMIN_PASSWORD', 'TENANT_SLUG', 'CLIENT_EMAIL', 'CLIENT_NAME', 'CLIENT_PASSWORD', 'REVALIDATE_SECRET']),
  ],
  'backend-migrate': () => [c('migrate', 'apply migrations', ['pnpm', 'migrate'], ['DATABASE_URL', 'PAYLOAD_SECRET'])],
  'backend-seed-admin': () => [c('seed-admin', 'platform-admin login (upsert)', ['pnpm', 'seed:admin'], ['MAKLERI_ADMIN_EMAIL', 'MAKLERI_ADMIN_PASSWORD'])],
  'starter-copy': (ctx) => [c('copy', `clients/${ctx.request.slug}/starter-copy.json: tone default if absent, then validated`, [])],
  'backend-seed-content': () => [
    c('seed-site', 'tenant + starter content (users untouched)', ['pnpm', 'seed:client-site'], ['PROVISIONING_REQUEST', 'STARTER_COPY_JSON', 'TENANT_SLUG', 'SITE_URL', 'REVALIDATE_SECRET']),
  ],
  'backend-seed-realtor': () => [c('seed-client', "the realtor's login (upsert by e-mail)", ['pnpm', 'seed:client'], ['TENANT_SLUG', 'CLIENT_EMAIL', 'CLIENT_NAME', 'CLIENT_PASSWORD'])],
  'backend-start': (ctx) => [c('dev', 'start the backend detached', ['pnpm', 'exec', 'next', 'dev', '--port', String(ctx.state.get().ports.backend)])],
  'site-key': () => [
    c('site-key', "mint the site's API key into a 0600 file (re-minted only if the stored key stops working)", ['pnpm', 'seed:site-key'], ['TENANT_SLUG', 'CMS_PROBE_URL', 'SITE_KEY_OUT']),
  ],
  'site-copy': (ctx) => [c('export', `export apps/site at platform@<HEAD sha> into site-${ctx.request.slug} (pristine + standalone commits)`, [])],
  'site-standalone': () => [c('standalone', 're-apply the standalone rewrite only if ports or the request changed', [])],
  'site-env': () => [c('env', '.env.local (0600)', [], ['NEXT_PUBLIC_CMS_URL', 'TENANT_ID', 'CMS_API_KEY', 'REVALIDATE_SECRET'])],
  'site-install': () => [c('install', 'install site dependencies; commit pnpm-lock.yaml', ['pnpm', 'install'])],
  'site-build': () => [c('build', 'production build (needs the backend up)', ['pnpm', 'build'])],
  'site-start': (ctx) => [c('start', 'start the site detached', ['pnpm', 'exec', 'next', 'start', '--port', String(ctx.state.get().ports.site)])],
  verify: () => [c('verify', 'standalone package.json, imports inside repo, typecheck, variant, section order, routes, media, enquiry, revalidate round trip, secrets-check', ['pnpm', 'typecheck'])],
  'crm-report': () => [c('crm', 'append the provisioning log entries to the CRM site record (keyed, idempotent)', [])],
  'outward-plan': (ctx) => [c('plan', `write clients/${ctx.request.slug}/outward-plan.md + .json`, [])],
  handover: () => [c('summary', 'print URLs, credential file paths, TODOs; commit the record', [])],
}
