import { RealvistaHome } from '@makleri/theme-realvista'

import { cms } from './cms'

export const revalidate = 3600

export default async function HomePage() {
  const [settings, featured, services] = await Promise.all([
    cms.getSiteSettings(),
    cms.getFeaturedListings(6),
    cms.getServices(),
  ])

  return <RealvistaHome settings={settings} featured={featured} services={services} />
}
