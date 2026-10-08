import { notFound } from 'next/navigation'

import site from '../../../site.config'
import { cms } from '../../cms'
import theme from '../../theme'

export const revalidate = 3600

export async function generateStaticParams() {
  if (!site.features.blog) return []
  const posts = await cms.getPosts(100)
  return posts.docs.filter((p) => p.slug).map((p) => ({ slug: p.slug as string }))
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!site.features.blog) notFound()

  const { slug } = await params
  const post = await cms.getPost(slug)
  if (!post) notFound()

  const [settings, recent] = await Promise.all([cms.getSiteSettings(), cms.getPosts(4)])

  const { PostDetail } = theme.pages

  return (
    <PostDetail
      site={site}
      settings={settings}
      post={post}
      recent={recent.docs.filter((p) => p.id !== post.id).slice(0, 3)}
    />
  )
}
