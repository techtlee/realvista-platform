import { RealvistaHome } from '@makleri/theme-realvista'

import { cms } from './cms'

export const revalidate = 3600

export default async function HomePage() {
  const [settings, featured, all, services, posts] = await Promise.all([
    cms.getSiteSettings(),
    cms.getFeaturedListings(8),
    cms.getListings({ limit: 50 }),
    cms.getServices(),
    cms.getPosts(3).catch(() => ({ docs: [] })),
  ])

  return (
    <RealvistaHome
      settings={settings}
      featured={featured}
      all={all.docs}
      services={services}
      posts={posts.docs}
      totalListings={all.totalDocs}
    />
  )
}
