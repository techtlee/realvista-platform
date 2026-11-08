import { CwError } from '../types.js'

/**
 * DNS records, restricted to the two kinds REALVISTA ever asks for.
 *
 * ARCHITECTURE.md: at the client's registrar, records only, never the
 * delegation, so their e-mail (MX) is untouched. That rule is enforced by
 * what this module can express, not by care: the record type is a union of
 * `A` and `CNAME` and nothing else, so a delegation or zone-authority record
 * cannot be constructed, typed, or passed to the argv builder. Records that
 * arrive as data (JSON) go through {@link assertDnsRecord}, which refuses any
 * other type at runtime.
 */

export const DNS_RECORD_TYPES = ['A', 'CNAME'] as const
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number]

/** Vercel's anycast address for an apex domain, and the CNAME target for subdomains. */
export const VERCEL_APEX_IP = '76.76.21.21'
export const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com'

interface RecordBase {
  /** fully qualified host name, lowercase, no trailing dot */
  readonly host: string
  /** the Vercel project the host serves, for the instructions */
  readonly project: string
}
export interface ARecord extends RecordBase {
  readonly type: 'A'
  readonly value: string
}
export interface CnameRecord extends RecordBase {
  readonly type: 'CNAME'
  readonly value: string
}
export type DnsRecord = ARecord | CnameRecord

const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function refuse(message: string): never {
  throw new CwError('OUTWARD_REFUSED', message, {
    hint: 'Only A (apex) and CNAME (www, admin and the realvista.cz fallbacks) records are ever planned.',
  })
}

export function aRecord(host: string, project: string, value: string = VERCEL_APEX_IP): ARecord {
  const r: ARecord = { type: 'A', host, value, project }
  assertDnsRecord(r)
  return r
}

export function cnameRecord(host: string, project: string, value: string = VERCEL_CNAME_TARGET): CnameRecord {
  const r: CnameRecord = { type: 'CNAME', host, value, project }
  assertDnsRecord(r)
  return r
}

/** Runtime gate for records that arrive as data. Refuses every type except A and CNAME. */
export function assertDnsRecord(r: unknown): asserts r is DnsRecord {
  if (typeof r !== 'object' || r === null) refuse('A DNS record must be an object.')
  const { type, host, value, project } = r as Record<string, unknown>
  if (!(DNS_RECORD_TYPES as readonly unknown[]).includes(type)) {
    refuse(`DNS record type ${JSON.stringify(type)} is not allowed. Allowed: ${DNS_RECORD_TYPES.join(', ')}.`)
  }
  if (typeof host !== 'string' || !HOST.test(host)) refuse(`Invalid DNS host ${JSON.stringify(host)}.`)
  if (typeof project !== 'string' || project.length === 0) refuse('A DNS record names the project it serves.')
  if (type === 'A' && (typeof value !== 'string' || !IPV4.test(value))) {
    refuse(`An A record needs an IPv4 address, got ${JSON.stringify(value)}.`)
  }
  if (type === 'CNAME' && (typeof value !== 'string' || !HOST.test(value))) {
    refuse(`A CNAME record needs a host name, got ${JSON.stringify(value)}.`)
  }
}

/**
 * The three records a client adds at their registrar (runbook 17): apex A to
 * the site, `www` CNAME to the site (redirects to the apex), `admin` CNAME to
 * the backend. Never more.
 */
export function clientDnsRecords(domain: string, repos: { site: string; backend: string }): DnsRecord[] {
  return [
    aRecord(domain, repos.site),
    cnameRecord(`www.${domain}`, repos.site),
    cnameRecord(`admin.${domain}`, repos.backend),
  ]
}

/**
 * Checks a client record set is exactly apex A + `www`/`admin` CNAMEs of
 * `domain`. A guard for anything that assembles or edits the set later.
 */
export function assertClientDnsRecords(records: readonly unknown[], domain: string): asserts records is DnsRecord[] {
  const allowed = new Map<string, DnsRecordType>([
    [domain, 'A'],
    [`www.${domain}`, 'CNAME'],
    [`admin.${domain}`, 'CNAME'],
  ])
  const seen = new Set<string>()
  for (const r of records) {
    assertDnsRecord(r)
    const want = allowed.get(r.host)
    if (!want) refuse(`${r.host} is not one of ${[...allowed.keys()].join(', ')}.`)
    if (r.type !== want) refuse(`${r.host} must be a ${want} record, not ${r.type}.`)
    if (seen.has(r.host)) refuse(`${r.host} appears twice.`)
    seen.add(r.host)
  }
}

/**
 * Records on our own zone (`<slug>.<base>`, `admin.<slug>.<base>`), only
 * needed if Vercel DNS does not already resolve them for the team's projects.
 */
export function fallbackDnsRecords(
  fallback: { site: string; admin: string },
  repos: { site: string; backend: string },
): CnameRecord[] {
  return [cnameRecord(fallback.site, repos.site), cnameRecord(fallback.admin, repos.backend)]
}

/**
 * argv for `vercel dns add <zone> <name> <type> <value>`. Takes a typed
 * record, so it has no way to emit any other record type.
 */
export function vercelDnsAddArgv(zone: string, r: DnsRecord, team: string): string[] {
  assertDnsRecord(r)
  if (r.host !== zone && !r.host.endsWith(`.${zone}`)) refuse(`${r.host} is not in the ${zone} zone.`)
  const name = r.host === zone ? '@' : r.host.slice(0, -(zone.length + 1))
  return ['vercel', 'dns', 'add', zone, name, r.type, r.value, '--scope', team]
}

/** One line per record, for instructions sent to a realtor. */
export function formatRecord(r: DnsRecord): string {
  return `${r.host.padEnd(28)} ${r.type.padEnd(6)} ${r.value.padEnd(22)} → ${r.project}`
}
