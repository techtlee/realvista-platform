import type { ThemeManifest } from '@makleri/theme-kit'

import { icons } from './icons.js'

/**
 * Everything about REALVISTA that is data rather than markup.
 *
 * The colourways live here, not in `@makleri/core`. They used to be a
 * `z.enum(['indigo','crimson','clay','mono'])` inside the package every client
 * site depends on, which meant a second layout could not have its own palette
 * without an edit shipped to all sixty sites.
 */
export const manifest: ThemeManifest = {
  name: 'realvista',
  label: 'REALVISTA',
  version: '0.1.0',

  /** Every CSS custom property this theme defines starts with `--rv-`. */
  tokenPrefix: 'rv',

  font: {
    googleFont: 'DM_Sans',
    weights: ['400', '500', '600', '700'],
    // latin-ext carries ě š č ř ž ů. Without it they fall back mid-word to a
    // system face, which is visible on almost every Czech listing title.
    subsets: ['latin', 'latin-ext'],
    cssVariable: '--font-dm-sans',
  },

  /**
   * Three taken verbatim from the Figma exports; mono is derived from the same
   * structure and should be replaced if a real export turns up.
   *
   * The swatch is the brand colour, which is what a storefront picker shows.
   */
  variants: [
    { value: 'indigo', label: { cs: 'Indigová' }, swatch: '#0d0053' },
    { value: 'crimson', label: { cs: 'Červená' }, swatch: '#ad0c14' },
    { value: 'clay', label: { cs: 'Hnědá' }, swatch: '#1c130d' },
    { value: 'mono', label: { cs: 'Černobílá' }, swatch: '#111111' },
  ],

  icons,

  stylesheet: './styles/theme.css',

  /** `Home` renders these, in this order, when `pages.home.sections` is unset. */
  sections: {
    home: ['hero', 'featured', 'services', 'agent', 'stats', 'contact', 'blog'],
  },
}
