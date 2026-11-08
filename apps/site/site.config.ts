import { defineSiteConfig } from '@makleri/core/config'

import theme from './app/theme'

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
export default defineSiteConfig(
  {
    siteId: 'demo-reality',
    theme: { name: 'realvista', variant: 'indigo' },
    domain: 'localhost:3001',
    cms: {
      url: process.env.NEXT_PUBLIC_CMS_URL ?? 'http://localhost:3000',
      tenantId: Number(process.env.TENANT_ID ?? 5),
    },
    features: { blog: true, listingMap: true, mortgageCalculator: true },
    pages: {
      home: { sections: ['hero', 'featured', 'services', 'agent', 'stats', 'contact', 'blog'] },
    },
  },
  theme,
)
