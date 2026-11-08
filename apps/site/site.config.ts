import { defineSiteConfig } from '@makleri/core/config'

import theme from './app/theme'
import { cmsUrl, siteUrl } from './site.urls'

/**
 * The entire client repo, in one file.
 *
 * A generated site contains this, a handful of one-line route files, and
 * nothing else. Everything visual and behavioural arrives from the versioned
 * packages, which is what makes a fleet-wide fix a lockfile bump.
 *
 * The theme is passed in so the colourway is checked against the layout that
 * actually implements it: `variant: 'purple'` would otherwise render the
 * default palette with no error anywhere, shipping the wrong brand colour to a
 * paying client.
 */
const site = defineSiteConfig(
  {
    siteId: 'demo-reality',
    theme: { name: 'realvista', variant: 'indigo' },
    domain: 'localhost:3001',
    cms: {
      url: cmsUrl,
      tenantId: Number(process.env.TENANT_ID ?? 5),
    },
    features: { blog: true, listingMap: true, mortgageCalculator: true },
    pages: {
      home: { sections: ['hero', 'featured', 'services', 'agent', 'stats', 'contact', 'blog'] },
    },
  },
  theme,
)

// next.config.ts reads site.urls.ts instead of this file, so the two must name
// the same origin. Fails the build rather than shipping a sitemap, canonical
// links and image origins that disagree with the site's own config.
if (site.siteUrl !== siteUrl) {
  throw new Error(
    `site.urls.ts siteUrl "${siteUrl}" does not match site.config.ts ("${site.siteUrl}", from domain). Regenerate both.`,
  )
}

export default site
