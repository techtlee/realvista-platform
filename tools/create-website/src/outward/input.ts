import { relative } from 'node:path'

import type { Ctx, ProvisioningRequest } from '../types.js'
import { OWNER, TEAM, type OutwardInput } from './types.js'

/** File name of the request envelope inside the record repo (the `input` step writes it). */
export const REQUEST_FILE = 'provisioning-request.json'

/**
 * The facts a plan needs, from the request alone. Pure, so tests and the
 * `cw plan --outward` path (before anything exists locally) can call it.
 */
export function outwardInput(o: {
  request: ProvisioningRequest
  subdomainBase: string
  /** relative to the config root; defaults to `clients/<name>` */
  dirs?: OutwardInput['dirs']
  owner?: string
  team?: string
}): OutwardInput {
  const { slug, provisioning, contact } = o.request
  const repos = { backend: `backend-${slug}`, site: `site-${slug}` }
  const d = provisioning.domain
  return {
    slug,
    owner: o.owner ?? OWNER,
    team: o.team ?? TEAM,
    subdomainBase: o.subdomainBase,
    repos,
    dirs: o.dirs ?? { record: `clients/${slug}`, backend: `clients/${repos.backend}`, site: `clients/${repos.site}` },
    fallback: { site: `${slug}.${o.subdomainBase}`, admin: `admin.${slug}.${o.subdomainBase}` },
    domain: {
      situation: d.situation,
      ...(d.situation !== 'none' && d.name ? { name: d.name } : {}),
      ...(d.registrar ? { registrar: d.registrar } : {}),
      emailOnDomain: d.emailOnDomain,
    },
    contact: { name: contact.name, email: contact.email },
    requestFile: REQUEST_FILE,
  }
}

/** The same, from a running engine context: directories as they actually are on disk. */
export function outwardInputFromCtx(ctx: Ctx): OutwardInput {
  const rel = (p: string) => relative(ctx.cfg.rootDir, p) || '.'
  return outwardInput({
    request: ctx.request,
    subdomainBase: ctx.cfg.subdomainBase,
    dirs: { record: rel(ctx.paths.record), backend: rel(ctx.paths.backend), site: rel(ctx.paths.site) },
  })
}
