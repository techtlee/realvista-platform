import { createNextConfig } from '@makleri/config'

// Not site.config.ts: see site.urls.ts for why next.config.ts must not load the theme.
import { cmsUrl, siteUrl } from './site.urls'

export default createNextConfig({ siteUrl, cmsUrl })
