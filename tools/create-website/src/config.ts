/**
 * Config discovery (A0): `create-website.config.json`, found by walking up
 * from the cwd; `--config` overrides the search; env `CW_*` overrides keys.
 * Relative paths resolve against the config file's directory.
 *
 * Tests and evals drop their own config into a temp cwd; that is the whole
 * isolation mechanism, so this module also owns the "is this the real
 * Makleri/clients?" check the test hooks depend on.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { z } from 'zod'

import { CwError, type Config } from './types.js'

export const CONFIG_FILE = 'create-website.config.json'

/** Never handed out, whatever a config says. */
export const ALWAYS_RESERVED_PORTS = [3000, 3001, 3003, 3004, 3017, 3027, 3029] as const

const range = z
  .tuple([z.number().int().min(1024).max(65535), z.number().int().min(1024).max(65535)])
  .refine(([a, b]) => a <= b, 'range start must be <= end')

const fileSchema = z.strictObject({
  $schema: z.string().optional(),
  clientsDir: z.string().min(1),
  platformRepo: z.string().min(1),
  cmsRepo: z.string().min(1),
  cmsRef: z.string().min(1).default('main'),
  postgres: z
    .strictObject({
      host: z.string().default('localhost'),
      port: z.number().int().default(5432),
      user: z.string().optional(),
      passwordFile: z.string().optional(),
    })
    .default({ host: 'localhost', port: 5432 }),
  dbPrefix: z
    .string()
    .regex(/^[a-z0-9_]*$/, 'dbPrefix is lowercase a-z, 0-9 and _')
    .default(''),
  ports: z
    .strictObject({
      site: range.default([3110, 3199]),
      backend: range.default([3210, 3299]),
      reserved: z.array(z.number().int()).default([...ALWAYS_RESERVED_PORTS]),
    })
    .default({ site: [3110, 3199], backend: [3210, 3299], reserved: [...ALWAYS_RESERVED_PORTS] }),
  crm: z
    .strictObject({
      url: z.url(),
      credentialsFile: z.string().optional(),
      apiKeyFile: z.string().optional(),
    })
    .optional(),
  subdomainBase: z.string().default('realvista.cz'),
  testMode: z.boolean().default(false),
})

export function findConfig(startDir: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    const p = join(dir, CONFIG_FILE)
    if (existsSync(p)) return p
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Env overrides: CW_CLIENTS_DIR, CW_PLATFORM_REPO, CW_CMS_REPO, CW_CMS_REF, CW_DB_PREFIX, CW_CRM_URL, CW_PG_HOST, CW_PG_PORT, CW_SUBDOMAIN_BASE. */
function applyEnv(raw: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw }
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined && v !== '') out[k] = v
  }
  set('clientsDir', env.CW_CLIENTS_DIR)
  set('platformRepo', env.CW_PLATFORM_REPO)
  set('cmsRepo', env.CW_CMS_REPO)
  set('cmsRef', env.CW_CMS_REF)
  set('dbPrefix', env.CW_DB_PREFIX)
  set('subdomainBase', env.CW_SUBDOMAIN_BASE)
  if (env.CW_CRM_URL) out.crm = { ...((raw.crm as object | undefined) ?? {}), url: env.CW_CRM_URL }
  if (env.CW_PG_HOST || env.CW_PG_PORT) {
    const pg = { ...((raw.postgres as Record<string, unknown> | undefined) ?? {}) }
    if (env.CW_PG_HOST) pg.host = env.CW_PG_HOST
    if (env.CW_PG_PORT) pg.port = Number(env.CW_PG_PORT)
    out.postgres = pg
  }
  return out
}

export function loadConfig(opts: { cwd?: string; configPath?: string; env?: NodeJS.ProcessEnv } = {}): Config {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? process.cwd()
  const configPath = opts.configPath ? resolve(cwd, opts.configPath) : (env.CW_CONFIG ? resolve(cwd, env.CW_CONFIG) : findConfig(cwd))
  if (!configPath || !existsSync(configPath)) {
    throw new CwError('CONFIG_INVALID', `no ${CONFIG_FILE} found${configPath ? ` at ${configPath}` : ` from ${cwd} upwards`}`, {
      hint: `Create ${CONFIG_FILE} in the Makleri root (see CREATE-WEBSITE-DESIGN.md A0) or pass --config.`,
    })
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (e) {
    throw new CwError('CONFIG_INVALID', `${configPath} is not valid JSON: ${(e as Error).message}`)
  }
  if (!raw || typeof raw !== 'object') throw new CwError('CONFIG_INVALID', `${configPath} must hold an object`)
  const parsed = fileSchema.safeParse(applyEnv(raw as Record<string, unknown>, env))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new CwError('CONFIG_INVALID', `${configPath}: ${issues}`)
  }
  const c = parsed.data
  const rootDir = dirname(configPath)
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(rootDir, p))
  const reserved = [...new Set([...ALWAYS_RESERVED_PORTS, ...c.ports.reserved])].sort((a, b) => a - b)
  const cfg: Config = {
    configPath,
    rootDir,
    clientsDir: abs(c.clientsDir),
    platformRepo: abs(c.platformRepo),
    cmsRepo: abs(c.cmsRepo),
    cmsRef: c.cmsRef,
    postgres: {
      host: c.postgres.host,
      port: c.postgres.port,
      ...(c.postgres.user ? { user: c.postgres.user } : {}),
      ...(c.postgres.passwordFile ? { passwordFile: abs(c.postgres.passwordFile) } : {}),
    },
    dbPrefix: c.dbPrefix,
    ports: { site: c.ports.site, backend: c.ports.backend, reserved },
    ...(c.crm
      ? {
          crm: {
            url: c.crm.url.replace(/\/+$/, ''),
            ...(c.crm.credentialsFile ? { credentialsFile: abs(c.crm.credentialsFile) } : {}),
            ...(c.crm.apiKeyFile ? { apiKeyFile: abs(c.crm.apiKeyFile) } : {}),
          },
        }
      : {}),
    subdomainBase: c.subdomainBase,
    testMode: c.testMode,
  }
  if (cfg.testMode && isRealClientsDir(cfg.clientsDir)) {
    throw new CwError('TEST_HOOKS_REFUSED', `a testMode config must not point at the real clients dir (${cfg.clientsDir})`)
  }
  return cfg
}

function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/**
 * True for Josef's real `Makleri/clients`, however it is spelled (the
 * Desktop path exists in two casings on this machine). Also honours
 * `CW_REAL_CLIENTS_DIR` for other machines.
 */
export function isRealClientsDir(p: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const r = real(p).replace(/\/+$/, '').toLowerCase()
  if (/(^|\/)makleri\/clients$/.test(r)) return true
  const extra = env.CW_REAL_CLIENTS_DIR
  return !!extra && real(extra).replace(/\/+$/, '').toLowerCase() === r
}

export function clientPaths(cfg: Config, slug: string): { record: string; backend: string; site: string } {
  return {
    record: join(cfg.clientsDir, slug),
    backend: join(cfg.clientsDir, `backend-${slug}`),
    site: join(cfg.clientsDir, `site-${slug}`),
  }
}
