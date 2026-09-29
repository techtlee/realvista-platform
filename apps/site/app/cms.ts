import { createCmsClient } from '@makleri/core/content'

import site from '../site.config'

/** One client per site, scoped to that site's tenant by its API key. */
export const cms = createCmsClient({
  url: site.cms.url,
  apiKey: process.env.CMS_API_KEY ?? '',
  tenantId: site.cms.tenantId,
})
