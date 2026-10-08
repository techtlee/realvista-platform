import type {
  EnquiryInput,
  ListingQuery,
  Paginated,
  Post,
  Property,
  Service,
  SiteSettings,
} from './types.js'

/**
 * Typed access to one tenant's content.
 *
 * Every request carries a tenant-scoped, read-only API key, so a leaked
 * environment variable on one client's site cannot read another's data. That is
 * defence in depth rather than the primary boundary — the CMS enforces tenant
 * scoping server-side regardless — but it means a mistake in a template is
 * contained to the site that made it.
 *
 * Reads are cached with Next's `fetch` tags so a content change can revalidate
 * exactly the affected pages instead of rebuilding the site.
 */

export interface CmsClientOptions {
  /** Payload origin, e.g. `https://cms.makleri.cz`. */
  url: string
  /** Tenant-scoped read-only API key. */
  apiKey: string
  tenantId: string | number
  /**
   * Safety-net revalidation window, in seconds.
   *
   * On-demand revalidation is the primary mechanism; this bounds how long a
   * page can stay stale if a webhook is ever dropped. An hour is a compromise
   * between "self-heals" and "pointless origin traffic".
   */
  revalidate?: number
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

export class CmsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message)
    this.name = 'CmsError'
  }
}

interface NextFetchInit extends RequestInit {
  next?: { revalidate?: number; tags?: string[] }
}

export interface CmsClient {
  getSiteSettings(): Promise<SiteSettings | null>
  getListings(query?: ListingQuery): Promise<Paginated<Property>>
  getListing(slug: string): Promise<Property | null>
  getFeaturedListings(limit?: number): Promise<Property[]>
  getSimilarListings(property: Property, limit?: number): Promise<Property[]>
  getPosts(limit?: number): Promise<Paginated<Post>>
  getPost(slug: string): Promise<Post | null>
  getServices(): Promise<Service[]>
  submitEnquiry(input: EnquiryInput): Promise<void>
  /** Cache tags this client emits, so route handlers can revalidate precisely. */
  tags: {
    all: string
    settings: string
    listings: string
    listing(slug: string): string
    posts: string
    post(slug: string): string
    services: string
  }
}

export function createCmsClient(options: CmsClientOptions): CmsClient {
  const {
    url,
    apiKey,
    tenantId,
    revalidate = 3600,
    fetchImpl = globalThis.fetch,
  } = options

  const origin = url.replace(/\/+$/, '')
  const scope = `tenant-${tenantId}`

  const tags = {
    all: scope,
    settings: `${scope}:site-settings`,
    listings: `${scope}:properties`,
    listing: (slug: string) => `${scope}:property:${slug}`,
    posts: `${scope}:posts`,
    post: (slug: string) => `${scope}:post:${slug}`,
    services: `${scope}:services`,
  }

  async function get<T>(path: string, cacheTags: string[]): Promise<T> {
    const init: NextFetchInit = {
      headers: {
        // Payload's API-key scheme. The key belongs to a read-only service
        // user that is a member of exactly one tenant.
        Authorization: `users API-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate, tags: [tags.all, ...cacheTags] },
    }

    const res = await fetchImpl(`${origin}${path}`, init)

    if (!res.ok) {
      throw new CmsError(
        `CMS request failed (${res.status} ${res.statusText})`,
        res.status,
        path,
      )
    }
    return (await res.json()) as T
  }

  function qs(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) search.set(k, String(v))
    }
    const s = search.toString()
    return s ? `?${s}` : ''
  }

  /**
   * Builds Payload's bracketed `where` syntax.
   *
   * The tenant filter is applied server-side from the API key, so it is
   * deliberately NOT sent here — a client-supplied tenant filter would be
   * security theatre and would mask a server-side misconfiguration.
   */
  function whereParams(query: ListingQuery): Record<string, string> {
    const w: Record<string, string> = {}
    const status = query.status ?? 'active'

    if (Array.isArray(status)) {
      status.forEach((s, i) => {
        w[`where[status][in][${i}]`] = s
      })
    } else {
      w['where[status][equals]'] = status
    }

    if (query.transactionType) w['where[transactionType][equals]'] = query.transactionType
    if (query.propertyType) w['where[propertyType][equals]'] = query.propertyType
    if (query.featured !== undefined) w['where[featured][equals]'] = String(query.featured)
    if (query.city) w['where[address.city][equals]'] = query.city

    return w
  }

  const client: CmsClient = {
    tags,

    async getSiteSettings() {
      const res = await get<{ docs: SiteSettings[] }>(
        `/api/site-settings${qs({ limit: 1, depth: 2 })}`,
        [tags.settings],
      )
      return res.docs[0] ?? null
    },

    async getListings(query = {}) {
      const params = {
        limit: query.limit ?? 12,
        page: query.page ?? 1,
        depth: 2,
        sort: query.sort ?? '-createdAt',
        ...whereParams(query),
      }
      return get<Paginated<Property>>(`/api/properties${qs(params)}`, [tags.listings])
    },

    async getListing(slug) {
      const res = await get<{ docs: Property[] }>(
        `/api/properties${qs({
          limit: 1,
          depth: 2,
          'where[slug][equals]': slug,
        })}`,
        [tags.listings, tags.listing(slug)],
      )
      return res.docs[0] ?? null
    },

    async getFeaturedListings(limit = 6) {
      const res = await client.getListings({ featured: true, limit })
      return res.docs
    },

    async getSimilarListings(property, limit = 3) {
      // Same transaction type and town is a good enough heuristic, and avoids
      // a bespoke endpoint. Excluding the current listing is done here because
      // Payload's `not_equals` on id complicates the query string for no gain.
      const res = await client.getListings({
        transactionType: property.transactionType,
        city: property.address?.city,
        limit: limit + 1,
      })
      return res.docs.filter((d) => d.id !== property.id).slice(0, limit)
    },

    async getPosts(limit = 9) {
      return get<Paginated<Post>>(
        `/api/posts${qs({ limit, depth: 1, sort: '-publishedAt' })}`,
        [tags.posts],
      )
    },

    async getPost(slug) {
      const res = await get<{ docs: Post[] }>(
        `/api/posts${qs({ limit: 1, depth: 1, 'where[slug][equals]': slug })}`,
        [tags.posts, tags.post(slug)],
      )
      return res.docs[0] ?? null
    },

    async getServices() {
      const res = await get<{ docs: Service[] }>(
        `/api/services${qs({ limit: 50, sort: 'order' })}`,
        [tags.services],
      )
      return res.docs
    },

    async submitEnquiry(input) {
      const res = await fetchImpl(`${origin}/api/enquiries`, {
        method: 'POST',
        headers: {
          Authorization: `users API-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...input,
          property: input.propertyId,
          consent: { ...input.consent, at: new Date().toISOString() },
        }),
        // A form submission must never be served from cache.
        cache: 'no-store',
      } as NextFetchInit)

      if (!res.ok) {
        throw new CmsError(
          `Enquiry submission failed (${res.status})`,
          res.status,
          '/api/enquiries',
        )
      }
    },
  }

  return client
}
