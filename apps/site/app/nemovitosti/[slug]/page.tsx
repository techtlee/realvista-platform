import { notFound } from 'next/navigation'
import { RealvistaPropertyDetail } from '@makleri/theme-realvista'

import { cms } from '../../cms'

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

  return <RealvistaPropertyDetail settings={settings} property={property} similar={similar} />
}
