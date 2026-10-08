import { assertFontMatches } from '@makleri/theme-kit'
import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import type { ReactNode } from 'react'

import site from '../site.config'
import theme from './theme'
import { VariantSwitcher } from './VariantSwitcher'
import './globals.css'

/**
 * The typeface is fixed per layout (D9) and declared in the theme's manifest.
 *
 * Every value here is written out because `next/font` rejects anything that is
 * not an explicit literal — it reads this call statically at build time. So the
 * block is generated from the manifest and then checked against it below,
 * rather than read from it. Drift otherwise shows up as a synthesised bold or
 * Czech characters in a fallback face, neither of which looks like a bug.
 */
const WEIGHTS = ['400', '500', '600', '700'] as const
const SUBSETS = ['latin', 'latin-ext'] as const
const CSS_VARIABLE = '--font-dm-sans'

const font = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})

assertFontMatches(
  theme.manifest.font,
  { weights: WEIGHTS, subsets: SUBSETS, cssVariable: CSS_VARIABLE },
  theme.manifest.label,
)

export const metadata: Metadata = {
  title: { default: site.brand.name ?? 'Reality', template: '%s' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // The colour variant is a single attribute: one build serves every colourway.
  return (
    <html lang={site.locale.split('-')[0]} data-variant={site.theme.variant} className={font.variable}>
      <body>
        {children}
        {/* Preview-only; never rendered on a real client site. */}
        {process.env.NEXT_PUBLIC_VARIANT_PREVIEW === '1' ? (
          <VariantSwitcher initial={site.theme.variant} variants={theme.manifest.variants} />
        ) : null}
      </body>
    </html>
  )
}
