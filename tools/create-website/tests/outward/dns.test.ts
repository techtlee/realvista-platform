import { describe, expect, expectTypeOf, it } from 'vitest'

import * as dnsModule from '../../src/outward/dns.js'
import {
  aRecord,
  assertClientDnsRecords,
  assertDnsRecord,
  clientDnsRecords,
  cnameRecord,
  DNS_RECORD_TYPES,
  fallbackDnsRecords,
  vercelDnsAddArgv,
  type DnsRecord,
  type DnsRecordType,
} from '../../src/outward/dns.js'
import { CwError } from '../../src/types.js'

/**
 * ARCHITECTURE.md: records only, never the delegation, so the client's e-mail
 * keeps working. These tests hold the DNS adapter to "cannot express it", not
 * "does not happen to".
 */

const repos = { site: 'site-novak-test', backend: 'backend-novak-test' }

describe('the record type', () => {
  it('is A or CNAME, nothing else', () => {
    expect([...DNS_RECORD_TYPES]).toEqual(['A', 'CNAME'])
    expectTypeOf<DnsRecordType>().toEqualTypeOf<'A' | 'CNAME'>()
    expectTypeOf<DnsRecord['type']>().toEqualTypeOf<'A' | 'CNAME'>()
  })

  it('cannot be built as a delegation or zone-authority record (compile time)', () => {
    // @ts-expect-error: 'NS' is not a DnsRecord type
    const ns: DnsRecord = { type: 'NS', host: 'novak-test.cz', value: 'ns1.vercel-dns.com', project: 'x' }
    // @ts-expect-error: 'SOA' is not a DnsRecord type
    const soa: DnsRecord = { type: 'SOA', host: 'novak-test.cz', value: 'x', project: 'x' }
    // ...and the runtime gate refuses them when they arrive as data anyway.
    expect(() => assertDnsRecord(ns)).toThrow(CwError)
    expect(() => assertDnsRecord(soa)).toThrow(CwError)
  })

  it('exports no builder for any other record type', () => {
    const names = Object.keys(dnsModule)
    expect(names.filter((n) => /(^|[^d])ns(record|server)?$|(^|[^d])ns(record|server)|soa|nameserver|delegat|mx/i.test(n))).toEqual([])
  })
})

describe('assertDnsRecord', () => {
  it.each(['NS', 'SOA', 'MX', 'TXT', 'AAAA', 'ns', 'cname', 'CAA', undefined])('refuses type %s', (type) => {
    expect(() => assertDnsRecord({ type, host: 'novak-test.cz', value: '76.76.21.21', project: 'p' })).toThrow(
      /not allowed/,
    )
  })

  it('refuses with OUTWARD_REFUSED (exit 7)', () => {
    try {
      assertDnsRecord({ type: 'NS', host: 'novak-test.cz', value: 'ns1.example.com', project: 'p' })
      expect.unreachable()
    } catch (e) {
      expect((e as CwError).code).toBe('OUTWARD_REFUSED')
      expect((e as CwError).exitCode).toBe(7)
    }
  })

  it('checks hosts and values', () => {
    expect(() => aRecord('Novak Test.cz', 'p')).toThrow(/host/)
    expect(() => aRecord('novak-test.cz', 'p', 'cname.vercel-dns.com')).toThrow(/IPv4/)
    expect(() => cnameRecord('www.novak-test.cz', 'p', '76.76.21.21')).toThrow(/host name/)
    expect(() => assertDnsRecord(null)).toThrow()
  })
})

describe('client records (runbook 17)', () => {
  it('are exactly apex A, www CNAME, admin CNAME', () => {
    expect(clientDnsRecords('novak-test.cz', repos)).toEqual([
      { type: 'A', host: 'novak-test.cz', value: '76.76.21.21', project: 'site-novak-test' },
      { type: 'CNAME', host: 'www.novak-test.cz', value: 'cname.vercel-dns.com', project: 'site-novak-test' },
      { type: 'CNAME', host: 'admin.novak-test.cz', value: 'cname.vercel-dns.com', project: 'backend-novak-test' },
    ])
  })

  it('pass their own guard', () => {
    expect(() => assertClientDnsRecords(clientDnsRecords('novak-test.cz', repos), 'novak-test.cz')).not.toThrow()
  })

  it('guard refuses any other host, a wrong type, a duplicate, or another record type', () => {
    const ok = clientDnsRecords('novak-test.cz', repos)
    expect(() => assertClientDnsRecords([...ok, cnameRecord('mail.novak-test.cz', 'p')], 'novak-test.cz')).toThrow(
      /not one of/,
    )
    expect(() => assertClientDnsRecords([cnameRecord('novak-test.cz', 'p')], 'novak-test.cz')).toThrow(/must be a A/)
    expect(() => assertClientDnsRecords([ok[1], ok[1]], 'novak-test.cz')).toThrow(/twice/)
    expect(() =>
      assertClientDnsRecords([{ type: 'NS', host: 'novak-test.cz', value: 'ns1.x.cz', project: 'p' }], 'novak-test.cz'),
    ).toThrow(/not allowed/)
  })
})

describe('fallback records on our zone (runbook 16)', () => {
  it('are two CNAMEs', () => {
    const r = fallbackDnsRecords({ site: 'novak-test.realvista.cz', admin: 'admin.novak-test.realvista.cz' }, repos)
    expect(r.map((x) => [x.type, x.host, x.project])).toEqual([
      ['CNAME', 'novak-test.realvista.cz', 'site-novak-test'],
      ['CNAME', 'admin.novak-test.realvista.cz', 'backend-novak-test'],
    ])
  })

  it('become `vercel dns add` argv with the label relative to the zone', () => {
    const [site, admin] = fallbackDnsRecords(
      { site: 'novak-test.realvista.cz', admin: 'admin.novak-test.realvista.cz' },
      repos,
    ) as [DnsRecord, DnsRecord]
    expect(vercelDnsAddArgv('realvista.cz', site, 'TEAM')).toEqual([
      'vercel', 'dns', 'add', 'realvista.cz', 'novak-test', 'CNAME', 'cname.vercel-dns.com', '--scope', 'TEAM',
    ])
    expect(vercelDnsAddArgv('realvista.cz', admin, 'TEAM')[4]).toBe('admin.novak-test')
  })

  it('the argv builder refuses a record outside the zone, and any record that is not A/CNAME', () => {
    expect(() => vercelDnsAddArgv('realvista.cz', cnameRecord('novak-test.cz', 'p'), 'TEAM')).toThrow(/zone/)
    const ns = { type: 'NS', host: 'x.realvista.cz', value: 'ns1.evil.cz', project: 'p' } as unknown as DnsRecord
    expect(() => vercelDnsAddArgv('realvista.cz', ns, 'TEAM')).toThrow(/not allowed/)
  })
})
