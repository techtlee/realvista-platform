import site from '../../site.config'
import { cms } from '../cms'
import theme from '../theme'

export const revalidate = 3600

export default async function ListingIndexPage() {
  const [settings, listings] = await Promise.all([
    cms.getSiteSettings(),
    cms.getListings({ limit: 50 }),
  ])

  const { ListingIndex } = theme.pages

  return (
    <ListingIndex
      site={site}
      settings={settings}
      listings={listings.docs}
      totalListings={listings.totalDocs}
    />
  )
}
