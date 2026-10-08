import site from '../site.config'
import { cms } from './cms'
import theme from './theme'

export const revalidate = 3600

export default async function HomePage() {
  const [settings, featured, listings, services, posts] = await Promise.all([
    cms.getSiteSettings(),
    cms.getFeaturedListings(8),
    cms.getListings({ limit: 50 }),
    cms.getServices(),
    cms.getPosts(3).catch(() => ({ docs: [] })),
  ])

  const { Home } = theme.pages

  return (
    <Home
      site={site}
      settings={settings}
      featured={featured}
      listings={listings.docs}
      totalListings={listings.totalDocs}
      services={services}
      posts={posts.docs}
    />
  )
}
