import { createNextConfig } from '@makleri/config'
import site from './site.config'

export default createNextConfig({
  siteUrl: site.siteUrl,
  cmsUrl: site.cms.url,
})
