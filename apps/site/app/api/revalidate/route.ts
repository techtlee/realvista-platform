import { revalidateTag } from 'next/cache'

import site from '../../../site.config'

/**
 * Purges cached content when the CMS says it changed.
 *
 * Pages are rendered once and served from cache with a one-hour safety net, so
 * without this a realtor's edit is invisible for up to an hour — which reads as
 * "the website is broken" long before it reads as "caching".
 *
 * The CMS calls this on every save. It revalidates by tag rather than
 * rebuilding, so one price change re-renders the pages that show that listing
 * and nothing else.
 */

const scope = `tenant-${site.cms.tenantId}`

export async function POST(req: Request) {
  const secret = req.headers.get('x-revalidate-secret')

  // Timing-safe comparison is overkill here — the secret is per-tenant, the
  // endpoint is unauthenticated by design, and the worst outcome of a guess is
  // a cache purge. A constant-time check would still be cheap, but the real
  // control is that the secret is never exposed to the browser.
  if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
    return Response.json({ revalidated: false, reason: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    collection?: string
    slug?: string
  }

  const tags = new Set<string>()

  switch (body.collection) {
    case 'properties':
      tags.add(`${scope}:properties`)
      if (body.slug) tags.add(`${scope}:property:${body.slug}`)
      break
    case 'posts':
      tags.add(`${scope}:posts`)
      if (body.slug) tags.add(`${scope}:post:${body.slug}`)
      break
    case 'services':
      tags.add(`${scope}:services`)
      break
    case 'site-settings':
      tags.add(`${scope}:site-settings`)
      break
    default:
      // Unknown or missing collection: purge the tenant's whole scope rather
      // than silently doing nothing. A new collection should not need a deploy
      // here before its edits show up.
      tags.add(scope)
  }

  // Next 16 requires a cache profile. `{ expire: 0 }` purges immediately —
  // `updateTag` would be the read-your-own-writes variant, but that is only
  // callable from a Server Action, and this is a webhook.
  for (const tag of tags) revalidateTag(tag, { expire: 0 })

  return Response.json({ revalidated: true, tags: [...tags], at: Date.now() })
}
