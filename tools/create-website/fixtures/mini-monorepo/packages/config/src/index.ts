import type { NextConfig } from 'next'

export function createNextConfig(i: { siteUrl: string; cmsUrl: string }): NextConfig {
  return { env: { SITE: i.siteUrl, CMS: i.cmsUrl } }
}
