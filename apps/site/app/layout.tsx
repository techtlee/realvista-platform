import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import type { ReactNode } from 'react'

import site from '../site.config'
import { VariantSwitcher } from './VariantSwitcher'
import './globals.css'

/**
 * DM Sans is the typeface in the design, across weights 400/500/600/700.
 * Loaded through next/font so it is self-hosted and does not block render.
 */
const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'], // latin-ext carries ě š č ř ž ů
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Reality', template: '%s' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // The colour variant is a single attribute: one build serves all four.
  return (
    <html lang="cs" data-variant={site.theme.variant} className={dmSans.variable}>
      <body>
        {children}
        {/* Preview-only; never rendered on a real client site. */}
        {process.env.NEXT_PUBLIC_VARIANT_PREVIEW === '1' ? (
          <VariantSwitcher initial={site.theme.variant} />
        ) : null}
      </body>
    </html>
  )
}
