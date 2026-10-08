import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCmsClient, CmsError } from '../src/content/client.js'
import type { Property } from '../src/content/types.js'

interface Call {
  url: string
  init: RequestInit & { next?: { revalidate?: number; tags?: string[] } }
}

let calls: Call[]

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: (init ?? {}) as Call['init'] })
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
    } as Response
  }) as unknown as typeof fetch
}

function client(body: unknown, status = 200) {
  return createCmsClient({
    url: 'https://cms.makleri.cz/',
    apiKey: 'test-key',
    tenantId: 7,
    fetchImpl: fakeFetch(body, status),
  })
}

const emptyPage = { docs: [], totalDocs: 0, page: 1, totalPages: 0, hasNextPage: false }

beforeEach(() => {
  calls = []
})

describe('authentication and scoping', () => {
  it('sends the tenant-scoped API key using Payload’s scheme', async () => {
    await client(emptyPage).getListings()

    const auth = (calls[0]!.init.headers as Record<string, string>).Authorization
    expect(auth).toBe('users API-Key test-key')
  })

  it('does NOT send a tenant filter from the client', async () => {
    // Scoping is enforced server-side from the API key. Sending a tenant filter
    // here would be security theatre, and worse: it would mask a server-side
    // misconfiguration by making cross-tenant reads look impossible in testing.
    await client(emptyPage).getListings()

    expect(calls[0]!.url).not.toMatch(/tenant/i)
  })

  it('normalises a trailing slash on the CMS origin', async () => {
    await client(emptyPage).getListings()
    expect(calls[0]!.url.startsWith('https://cms.makleri.cz/api/')).toBe(true)
    expect(calls[0]!.url).not.toContain('//api/')
  })
})

describe('caching', () => {
  it('tags every request with the tenant scope', async () => {
    const c = client(emptyPage)
    await c.getListings()

    expect(calls[0]!.init.next?.tags).toContain('tenant-7')
  })

  it('tags a single listing so one edit can revalidate exactly one page', async () => {
    const c = client({ docs: [] })
    await c.getListing('byt-praha-6')

    expect(calls[0]!.init.next?.tags).toContain('tenant-7:property:byt-praha-6')
  })

  it('applies a safety-net revalidation window so a dropped webhook self-heals', async () => {
    await client(emptyPage).getListings()
    expect(calls[0]!.init.next?.revalidate).toBe(3600)
  })

  it('never caches a form submission', async () => {
    await client({}).submitEnquiry({
      name: 'Jan Novák',
      email: 'jan@example.cz',
      consent: { given: true, text: 'Souhlasím se zpracováním osobních údajů.' },
    })

    expect(calls[0]!.init.cache).toBe('no-store')
  })
})

describe('queries', () => {
  it('defaults to active listings only', async () => {
    await client(emptyPage).getListings()
    expect(decodeURIComponent(calls[0]!.url)).toContain('where[status][equals]=active')
  })

  it('supports several statuses', async () => {
    await client(emptyPage).getListings({ status: ['active', 'reserved'] })

    const url = decodeURIComponent(calls[0]!.url)
    expect(url).toContain('where[status][in][0]=active')
    expect(url).toContain('where[status][in][1]=reserved')
  })

  it('filters featured listings for the homepage', async () => {
    await client(emptyPage).getFeaturedListings(4)

    const url = decodeURIComponent(calls[0]!.url)
    expect(url).toContain('where[featured][equals]=true')
    expect(url).toContain('limit=4')
  })

  it('returns null rather than throwing for a missing listing', async () => {
    const result = await client({ docs: [] }).getListing('neexistuje')
    expect(result).toBeNull()
  })
})

describe('similar listings', () => {
  const subject = {
    id: 1,
    title: 'Byt 3+kk',
    transactionType: 'prodej',
    address: { city: 'Brno' },
  } as Property

  it('excludes the listing currently being viewed', async () => {
    const docs = [
      { ...subject },
      { ...subject, id: 2, title: 'Jiný byt' },
      { ...subject, id: 3, title: 'Další byt' },
      { ...subject, id: 4, title: 'Čtvrtý byt' },
    ]

    const result = await client({ ...emptyPage, docs }).getSimilarListings(subject, 3)

    expect(result.map((d) => d.id)).toEqual([2, 3, 4])
    expect(result).toHaveLength(3)
  })

  it('matches on transaction type and town', async () => {
    await client({ ...emptyPage, docs: [] }).getSimilarListings(subject)

    const url = decodeURIComponent(calls[0]!.url)
    expect(url).toContain('where[transactionType][equals]=prodej')
    expect(url).toContain('where[address.city][equals]=Brno')
  })
})

describe('errors', () => {
  it('raises CmsError carrying the status and path', async () => {
    const c = client({}, 503)

    await expect(c.getListings()).rejects.toBeInstanceOf(CmsError)
    await expect(c.getListings()).rejects.toMatchObject({ status: 503 })
  })

  it('raises when an enquiry cannot be delivered', async () => {
    const c = client({}, 500)

    await expect(
      c.submitEnquiry({
        name: 'Jan',
        consent: { given: true, text: 'Souhlas' },
      }),
    ).rejects.toBeInstanceOf(CmsError)
  })
})

describe('enquiries', () => {
  it('stamps the consent timestamp server-side rather than trusting the form', async () => {
    await client({}).submitEnquiry({
      name: 'Jan Novák',
      propertyId: 42,
      consent: { given: true, text: 'Souhlasím.' },
    })

    const body = JSON.parse(calls[0]!.init.body as string)

    expect(body.consent.at).toBeTruthy()
    expect(Number.isNaN(Date.parse(body.consent.at))).toBe(false)
    // The verbatim wording is preserved, so what the visitor agreed to is provable.
    expect(body.consent.text).toBe('Souhlasím.')
    expect(body.property).toBe(42)
  })
})
