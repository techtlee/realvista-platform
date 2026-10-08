import { notFound } from 'next/navigation'

import site from '../../site.config'
import { cms } from '../cms'
import theme from '../theme'

export const revalidate = 3600

export default async function BlogIndexPage() {
  // The header and footer link here unconditionally, so a site with the blog
  // switched off must 404 rather than render an empty page under a heading.
  if (!site.features.blog) notFound()

  const [settings, posts] = await Promise.all([cms.getSiteSettings(), cms.getPosts(50)])

  const { BlogIndex } = theme.pages

  return <BlogIndex site={site} settings={settings} posts={posts.docs} />
}
