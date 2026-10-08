import { notFound } from 'next/navigation'

import site from '../../../site.config'
import { cms } from '../../cms'
import theme from '../../theme'

export const revalidate = 3600

export async function generateStaticParams() {
  const listings = await cms.getListings({ limit: 100 })
  return listings.docs.filter((p) => p.slug).map((p) => ({ slug: p.slug as string }))
}

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const property = await cms.getListing(slug)
  if (!property) notFound()

  const [settings, similar] = await Promise.all([
    cms.getSiteSettings(),
    cms.getSimilarListings(property, 3),
  ])

  const { PropertyDetail } = theme.pages

  return <PropertyDetail site={site} settings={settings} property={property} similar={similar} />
}
