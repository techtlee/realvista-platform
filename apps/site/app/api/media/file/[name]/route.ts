import site from '../../../../../site.config'

/**
 * Streams a tenant's uploaded media.
 *
 * Media on the CMS is tenant-scoped, so an anonymous `<img>` request is
 * refused — correctly: without that, knowing a filename would return another
 * realtor's photos. But a public website cannot attach an API key to an image
 * tag either, so the site fetches on the browser's behalf using its own
 * tenant-scoped key. A visitor can only ever reach this site's own media.
 *
 * With R2 configured this route is bypassed entirely: the adapter returns
 * absolute URLs on the bucket's public domain, where the protection is
 * unguessable tenant-prefixed keys rather than an access check.
 */
export const revalidate = 86400

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params

  const upstream = await fetch(`${site.cms.url}/api/media/file/${encodeURIComponent(name)}`, {
    headers: { Authorization: `users API-Key ${process.env.CMS_API_KEY ?? ''}` },
    next: { revalidate: 86400 },
  })

  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.status === 404 ? 404 : 502 })
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      // Filenames are content-addressed by Payload, so a long immutable cache
      // is safe and keeps image traffic off the CMS.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
