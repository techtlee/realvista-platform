import { RealvistaListingIndex } from '@makleri/theme-realvista'

import { cms } from '../cms'

export const revalidate = 3600

export default async function ListingIndexPage() {
  const [settings, listings] = await Promise.all([
    cms.getSiteSettings(),
    cms.getListings({ limit: 50 }),
  ])

  return <RealvistaListingIndex settings={settings} properties={listings.docs} />
}
