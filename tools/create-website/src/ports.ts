/**
 * Local port allocation, stable per slug.
 *
 * Registry: `clients/.create-website-ports.json`. A slug keeps its ports for
 * life (so bookmarks, `.env.local` and the CMS's revalidate URL stay right
 * across resumes). New slugs get the lowest port in the configured range that
 * is not reserved, not registered to another slug, and not in use right now.
 * novak-test (client #1, provisioned by hand) is pre-registered at 3017/3027.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { CwError, type Config } from './types.js'

export const PORTS_FILE = '.create-website-ports.json'

export type PortPair = { site: number; backend: number }

export interface PortRegistry {
  registryVersion: 1
  slugs: Record<string, PortPair>
}

export const PRE_REGISTERED: Record<string, PortPair> = { 'novak-test': { site: 3017, backend: 3027 } }

export function readRegistry(clientsDir: string): PortRegistry {
  const p = join(clientsDir, PORTS_FILE)
  if (!existsSync(p)) return { registryVersion: 1, slugs: { ...PRE_REGISTERED } }
  const r = JSON.parse(readFileSync(p, 'utf8')) as PortRegistry
  return { registryVersion: 1, slugs: { ...PRE_REGISTERED, ...r.slugs } }
}

function writeRegistry(clientsDir: string, r: PortRegistry): void {
  mkdirSync(clientsDir, { recursive: true })
  const p = join(clientsDir, PORTS_FILE)
  const tmp = `${p}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  writeFileSync(tmp, JSON.stringify(r, null, 2) + '\n')
  renameSync(tmp, p)
}

/** True when nothing listens on the port (IPv4 and IPv6 loopback/any). */
export async function isPortFree(port: number): Promise<boolean> {
  const tryListen = (host: string) =>
    new Promise<boolean>((resolve) => {
      const srv = createServer()
      srv.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT'))
      srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)))
    })
  for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
    if (!(await tryListen(host))) return false
  }
  return true
}

export interface AllocateOptions {
  cfg: Pick<Config, 'clientsDir' | 'ports'>
  slug: string
  /** explicit --site-port / --backend-port */
  want?: Partial<PortPair>
  isFree?: (port: number) => Promise<boolean>
}

/**
 * Returns the slug's ports, registering new ones. Never returns a reserved
 * port or another slug's port. Already-registered ports are returned even if
 * busy right now (our own process may hold them); the start steps decide.
 */
export async function allocatePorts(o: AllocateOptions): Promise<PortPair & { registered: boolean }> {
  const isFree = o.isFree ?? isPortFree
  const reg = readRegistry(o.cfg.clientsDir)
  const reserved = new Set(o.cfg.ports.reserved)
  const others = new Set(
    Object.entries(reg.slugs)
      .filter(([s]) => s !== o.slug)
      .flatMap(([, p]) => [p.site, p.backend]),
  )
  const existing = reg.slugs[o.slug]

  const check = (port: number, kind: string) => {
    if (reserved.has(port)) throw new CwError('PORT_BUSY', `${kind} port ${port} is reserved`, { hint: `Reserved: ${[...reserved].join(', ')}` })
    if (others.has(port)) throw new CwError('PORT_BUSY', `${kind} port ${port} is registered to another client`)
  }

  const pick = async (kind: 'site' | 'backend', taken: Set<number>): Promise<number> => {
    const [lo, hi] = o.cfg.ports[kind]
    for (let p = lo; p <= hi; p++) {
      if (reserved.has(p) || others.has(p) || taken.has(p)) continue
      if (await isFree(p)) return p
    }
    throw new CwError('NO_FREE_PORT', `no free ${kind} port in ${lo}-${hi}`, { hint: 'Free a port or widen ports.' + kind + ' in the config.' })
  }

  let site = o.want?.site ?? existing?.site
  let backend = o.want?.backend ?? existing?.backend
  if (o.want?.site !== undefined) check(o.want.site, 'site')
  if (o.want?.backend !== undefined) check(o.want.backend, 'backend')
  if (site === undefined) site = await pick('site', new Set(backend !== undefined ? [backend] : []))
  if (backend === undefined) backend = await pick('backend', new Set([site]))
  if (site === backend) throw new CwError('PORT_BUSY', `site and backend cannot share port ${site}`)

  const changed = !existing || existing.site !== site || existing.backend !== backend
  if (changed) {
    reg.slugs[o.slug] = { site, backend }
    writeRegistry(o.cfg.clientsDir, reg)
  }
  return { site, backend, registered: changed }
}

export function releasePorts(clientsDir: string, slug: string): void {
  if (slug in PRE_REGISTERED) return
  const reg = readRegistry(clientsDir)
  if (!(slug in reg.slugs)) return
  delete reg.slugs[slug]
  writeRegistry(clientsDir, reg)
}
