import { posix } from 'node:path'

import { OUTWARD_ENABLED, OutwardDisabledError, type OutwardStepId } from '../types.js'
import { clientDnsRecords, fallbackDnsRecords, vercelDnsAddArgv } from './dns.js'
import type { OutwardAdapter, OutwardCommand, OutwardInput, OutwardPlan } from './types.js'

/**
 * The nine outward adapters, one per outward step id, in runbook order.
 *
 * Every one is plan-only. `apply()` exists so the shape is ready for the day
 * outward steps are enabled, and until then it can only throw: there is no
 * code path from here to `gh`, `vercel`, `neonctl` or any HTTP API.
 */

function adapter(
  step: OutwardStepId,
  title: string,
  runbook: string,
  plan: (i: OutwardInput) => Omit<OutwardPlan, 'step' | 'title' | 'runbook'>,
): OutwardAdapter {
  return {
    step,
    title,
    runbook,
    plan: (i) => ({ step, title, runbook, ...plan(i) }),
    async apply() {
      // OUTWARD_ENABLED is the literal `false`; this branch is the only one.
      if (!OUTWARD_ENABLED) throw new OutwardDisabledError(`${step} (${title})`)
      throw new OutwardDisabledError(`${step}: no apply() is implemented`)
    },
  }
}

const backendFirst = (i: OutwardInput) =>
  [
    { repo: i.repos.backend, cwd: 'backend' },
    { repo: i.repos.site, cwd: 'site' },
  ] as const

const hasCustomDomain = (i: OutwardInput): i is OutwardInput & { domain: { name: string } } =>
  i.domain.situation !== 'none' && !!i.domain.name

// ── 13 ──────────────────────────────────────────────────────────────────────

export const githubRepos = adapter('github-repos', 'GitHub repos', '13', (i) => ({
  summary: 'Create both repos from the local copies and push them. Backend first. Public during development.',
  commands: backendFirst(i).map(({ repo, cwd }) => ({
    id: `github-repos:${cwd}`,
    description: `Create ${i.owner}/${repo} and push main`,
    cwd,
    argv: ['gh', 'repo', 'create', `${i.owner}/${repo}`, '--public', '--source', '.', '--remote', 'origin', '--push'],
    idempotencyProbe: ['gh', 'repo', 'view', `${i.owner}/${repo}`],
  })),
  instructions: ['Public during development (Josef\'s decision); they go private at go-live (step 19).'],
}))

// ── 14 ──────────────────────────────────────────────────────────────────────

export const postgresHosting = adapter('postgres-hosting', 'Postgres for the backend', '14', (i) => ({
  summary:
    'One database per client. Provider not chosen yet (ARCHITECTURE "Still open"); Neon in the EU is the placeholder.',
  commands: [
    {
      id: 'postgres-hosting:create',
      description: `Create the database project ${i.repos.backend} and store its URL as DATABASE_URL`,
      cwd: 'backend',
      argv: ['neonctl', 'projects', 'create', '--name', i.repos.backend, '--region-id', 'aws-eu-central-1', '--output', 'json'],
      captureTo: { file: 'backend/.env.production.local', key: 'DATABASE_URL', jq: '.connection_uris[0].connection_uri' },
      note: `Check \`neonctl projects list\` for ${i.repos.backend} first; create only if missing.`,
    },
  ],
  instructions: ['Schema: no manual step. prodMigrations runs pending migrations on first boot.'],
}))

// ── 15 ──────────────────────────────────────────────────────────────────────

export const vercelProjects = adapter('vercel-projects', 'Vercel projects', '15', (i) => ({
  summary: 'Link each repo to a Vercel project of the same name and connect it to its GitHub repo.',
  commands: backendFirst(i).flatMap(({ repo, cwd }): OutwardCommand[] => [
    {
      id: `vercel-projects:${cwd}:link`,
      description: `Link ${repo} to the Vercel project ${repo}`,
      cwd,
      argv: ['vercel', 'link', '--yes', '--project', repo, '--scope', i.team],
      note: '`vercel project ls` first; linking an existing project is safe.',
    },
    {
      id: `vercel-projects:${cwd}:git`,
      description: `Connect the project to ${i.owner}/${repo}`,
      cwd,
      argv: ['vercel', 'git', 'connect'],
    },
  ]),
  instructions: [],
}))

const ENV_PROD = 'backend/.env.production.local' as const
const SITE_PROD = 'site/.env.production.local' as const

const generate = (key: string, slug: string, file = ENV_PROD): OutwardCommand => ({
  id: `vercel-env:generate:${key}`,
  description: `Generate ${key} for production (created if missing, never overwritten, never shown)`,
  cwd: 'root',
  argv: ['cw', 'secret-pipe', '--generate', slug, file, key],
})

const envAdd = (cwd: 'backend' | 'site', name: string, stdin: OutwardCommand['stdin']): OutwardCommand => ({
  id: `vercel-env:${cwd}:${name}`,
  description: `Set ${name} on the ${cwd} project (production)`,
  cwd,
  argv: ['vercel', 'env', 'add', name, 'production'],
  ...(stdin ? { stdin } : {}),
})

/** Matches the backend template's `.env*.local` ignore rule, so the minted key can never be committed. */
const SITE_KEY_FILE = '.env.site-key.production.local'

const R2_KEYS = ['R2_BUCKET', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL']

export const vercelEnv = adapter('vercel-env', 'Vercel env, production seed, deploy', '15', (i) => {
  const adminUrl = `https://${i.fallback.admin}`
  const siteUrl = `https://${i.fallback.site}`
  const seed = (script: string, env: Record<string, string> = {}): OutwardCommand => ({
    id: `vercel-env:seed:${script}`,
    description: `Run ${script} against the production database`,
    cwd: 'backend',
    argv: ['pnpm', script],
    env: { NODE_ENV: 'production', ...env },
    envFrom: [ENV_PROD],
  })
  return {
    summary:
      'Backend env and deploy, then seed production once it is up, then the site env and deploy. ' +
      'Production secrets are new values in the production files, never the local dev ones.',
    commands: [
      generate('PAYLOAD_SECRET', i.slug),
      generate('MAKLERI_ADMIN_PASSWORD', i.slug),
      generate('CLIENT_PASSWORD', i.slug),
      generate('REVALIDATE_SECRET', i.slug),
      envAdd('backend', 'DATABASE_URL', { kind: 'secret', file: ENV_PROD, key: 'DATABASE_URL' }),
      envAdd('backend', 'PAYLOAD_SECRET', { kind: 'secret', file: ENV_PROD, key: 'PAYLOAD_SECRET' }),
      envAdd('backend', 'PLATFORM_SUBDOMAIN_BASE', { kind: 'value', value: i.subdomainBase }),
      ...R2_KEYS.map((k) => envAdd('backend', k, { kind: 'secret', file: ENV_PROD, key: k })),
      { id: 'vercel-env:backend:deploy', description: 'Deploy the backend', cwd: 'backend', argv: ['vercel', 'deploy', '--prod'] },
      seed('seed:admin'),
      {
        ...seed('seed:client-site', {
          PROVISIONING_REQUEST: posix.join(posix.relative(i.dirs.backend, i.dirs.record), i.requestFile),
          SITE_URL: siteUrl,
        }),
        note: 'Prints TENANT_ID=<n>; keep it as $TENANT_ID for the site env below.',
      },
      seed('seed:client', { TENANT_SLUG: i.slug, CLIENT_NAME: i.contact.name, CLIENT_EMAIL: i.contact.email }),
      {
        ...seed('seed:site-key', { TENANT_SLUG: i.slug, CMS_PROBE_URL: adminUrl, SITE_KEY_OUT: SITE_KEY_FILE }),
        note: 'M3: the key goes to the file (0600), stdout carries only TENANT_ID and the verification.',
      },
      {
        id: 'vercel-env:site-key:store',
        description: 'Move the minted key into the site production file as CMS_API_KEY',
        cwd: 'root',
        argv: ['cw', 'secret-pipe', '--write', i.slug, SITE_PROD, 'CMS_API_KEY', '--from-file', posix.join(i.dirs.backend, SITE_KEY_FILE), '--delete-source'],
      },
      envAdd('site', 'NEXT_PUBLIC_CMS_URL', { kind: 'value', value: adminUrl }),
      envAdd('site', 'TENANT_ID', { kind: 'shell-var', name: 'TENANT_ID' }),
      envAdd('site', 'CMS_API_KEY', { kind: 'secret', file: SITE_PROD, key: 'CMS_API_KEY' }),
      envAdd('site', 'REVALIDATE_SECRET', { kind: 'secret', file: ENV_PROD, key: 'REVALIDATE_SECRET' }),
      { id: 'vercel-env:site:deploy', description: 'Deploy the site', cwd: 'site', argv: ['vercel', 'deploy', '--prod'] },
    ],
    instructions: [
      'R2 is required in production (the backend config throws without it). Put R2_BUCKET, R2_ENDPOINT, ' +
        'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_URL into backend/.env.production.local before ' +
        'the backend env step; one bucket or prefix per client is still to be decided (F16).',
      'Set MAKLERI_ADMIN_EMAIL in backend/.env.production.local by hand: it is ours, not the client\'s.',
      'Order matters: the site build reads the backend, so backend env, deploy and seed come first (F11).',
    ],
  }
})

// ── 16 ──────────────────────────────────────────────────────────────────────

export const fallbackDomains = adapter('fallback-domains', 'Fallback addresses', '16', (i) => {
  const records = fallbackDnsRecords(i.fallback, i.repos)
  return {
    summary: `Attach ${i.fallback.site} and ${i.fallback.admin}. ${i.subdomainBase} is on Vercel DNS, so no manual DNS work.`,
    commands: [
      {
        id: 'fallback-domains:site',
        description: `Attach ${i.fallback.site} to ${i.repos.site}`,
        cwd: 'site',
        argv: ['vercel', 'domains', 'add', i.fallback.site, i.repos.site, '--scope', i.team],
        note: 'An existing domain answers with a conflict: treat that as done.',
      },
      {
        id: 'fallback-domains:admin',
        description: `Attach ${i.fallback.admin} to ${i.repos.backend}`,
        cwd: 'backend',
        argv: ['vercel', 'domains', 'add', i.fallback.admin, i.repos.backend, '--scope', i.team],
        note: 'An existing domain answers with a conflict: treat that as done.',
      },
      ...records.map(
        (r): OutwardCommand => ({
          id: `fallback-domains:record:${r.host}`,
          description: `CNAME ${r.host} → ${r.value}`,
          cwd: 'root',
          argv: vercelDnsAddArgv(i.subdomainBase, r, i.team),
          note: `Only if Vercel DNS does not already resolve ${r.host} for the team's projects.`,
        }),
      ),
    ],
    instructions: [],
  }
})

// ── deploy hook (part of 16 in the runbook) ─────────────────────────────────

export const deployHook = adapter('deploy-hook', 'Deploy hook', '16', () => ({
  summary: 'Not needed (ISR).',
  notNeeded:
    'Client sites use ISR with on-demand revalidation (ARCHITECTURE, decided 2026-11-08): a save in the ' +
    'admin calls the site\'s /api/revalidate and the page re-renders on the next request. No rebuild per ' +
    'save, so no deploy hook. Template or config changes deploy through a git push.',
  commands: [],
  instructions: [],
}))

// ── 17 ──────────────────────────────────────────────────────────────────────

export const clientDns = adapter('client-dns', 'Client DNS (records only)', '17', (i) => {
  if (!hasCustomDomain(i)) {
    return {
      summary: 'The client has no domain yet: the site runs on the fallback addresses only.',
      commands: [],
      instructions: [
        `Nothing to send. The site stays on https://${i.fallback.site} and the admin on https://${i.fallback.admin} until the client has a domain.`,
      ],
    }
  }
  const records = clientDnsRecords(i.domain.name, i.repos)
  const registrar = i.domain.registrar && i.domain.registrar !== 'unknown' ? i.domain.registrar : 'their registrar'
  const mail =
    i.domain.emailOnDomain === 'no'
      ? 'Every other record stays as it is.'
      : 'Their e-mail (MX) and every other record stay exactly as they are.'
  return {
    summary: `Send the realtor three records to add at ${registrar}. There is nothing to run.`,
    commands: [],
    records,
    instructions: [
      `Add or change only these three records. ${mail}`,
      i.domain.situation === 'have-no-access'
        ? 'The client has no access to the domain yet: they get access from whoever registered it first, then add the records.'
        : 'The realtor adds them, or gives us access to their registrar account.',
      'Then go-live (step 19) attaches the domain to the projects.',
    ],
  }
})

// ── 18 ──────────────────────────────────────────────────────────────────────

export const dependabotEnable = adapter('dependabot-enable', 'Dependabot', '18', (i) => ({
  summary: '.github/dependabot.yml is already committed in both repos. Turn on alerts and security fixes after the push.',
  commands: backendFirst(i).flatMap(({ repo, cwd }): OutwardCommand[] => [
    {
      id: `dependabot-enable:${cwd}:alerts`,
      description: `Enable vulnerability alerts on ${i.owner}/${repo}`,
      cwd: 'root',
      argv: ['gh', 'api', '-X', 'PUT', `repos/${i.owner}/${repo}/vulnerability-alerts`],
    },
    {
      id: `dependabot-enable:${cwd}:fixes`,
      description: `Enable automated security fixes on ${i.owner}/${repo}`,
      cwd: 'root',
      argv: ['gh', 'api', '-X', 'PUT', `repos/${i.owner}/${repo}/automated-security-fixes`],
    },
  ]),
  instructions: [],
}))

// ── 19 ──────────────────────────────────────────────────────────────────────

export const goLive = adapter('go-live', 'Go-live', '19', (i) => {
  const domainCommands: OutwardCommand[] = hasCustomDomain(i)
    ? [
        {
          id: 'go-live:domain:apex',
          description: `Attach ${i.domain.name} to ${i.repos.site}`,
          cwd: 'site',
          argv: ['vercel', 'domains', 'add', i.domain.name, i.repos.site, '--scope', i.team],
        },
        {
          id: 'go-live:domain:www',
          description: `Attach www.${i.domain.name} to ${i.repos.site} (redirect it to the apex in the project settings)`,
          cwd: 'site',
          argv: ['vercel', 'domains', 'add', `www.${i.domain.name}`, i.repos.site, '--scope', i.team],
        },
        {
          id: 'go-live:domain:admin',
          description: `Attach admin.${i.domain.name} to ${i.repos.backend}`,
          cwd: 'backend',
          argv: ['vercel', 'domains', 'add', `admin.${i.domain.name}`, i.repos.backend, '--scope', i.team],
        },
      ]
    : []
  return {
    summary: 'Replace the draft legal texts, attach the client domain once their records resolve, make both repos private, mark the site live in the CRM.',
    commands: [
      ...domainCommands,
      ...backendFirst(i).map(
        ({ repo, cwd }): OutwardCommand => ({
          id: `go-live:private:${cwd}`,
          description: `Make ${i.owner}/${repo} private`,
          cwd: 'root',
          argv: ['gh', 'repo', 'edit', `${i.owner}/${repo}`, '--visibility', 'private', '--accept-visibility-change-consequences'],
        }),
      ),
    ],
    instructions: [
      'First replace the [NÁVRH] legal texts and every [DOPLNIT] placeholder with the client\'s real ones.',
      ...(hasCustomDomain(i)
        ? [
            `After the domain resolves: regenerate site.config.ts and site.urls.ts with domain ${i.domain.name}, set NEXT_PUBLIC_CMS_URL to https://admin.${i.domain.name}, and set the tenant's hosting.siteUrl to https://${i.domain.name} in the admin (re-running seed:client-site would reset the content).`,
          ]
        : []),
      'In the CRM: site status live (sets liveSince); fill hosting.siteRepo, backendRepo, vercelSiteProject and vercelBackendProject.',
    ],
  }
})

/** All outward adapters, in the order of OUTWARD_STEP_IDS. */
export const OUTWARD_ADAPTERS: readonly OutwardAdapter[] = [
  githubRepos,
  postgresHosting,
  vercelProjects,
  vercelEnv,
  fallbackDomains,
  deployHook,
  clientDns,
  dependabotEnable,
  goLive,
]

export function outwardAdapter(step: OutwardStepId): OutwardAdapter {
  const a = OUTWARD_ADAPTERS.find((x) => x.step === step)
  if (!a) throw new Error(`no outward adapter for ${step}`)
  return a
}
