import { createNextConfig } from '@makleri/config'

// B2: the origins come from site.urls.ts
import { cmsUrl, siteUrl } from './site.urls'

export default createNextConfig({ siteUrl, cmsUrl })
