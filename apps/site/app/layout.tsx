import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import site from '../site.config'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Reality', template: '%s' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // The colour variant is a single attribute: one build serves all four.
  return (
    <html lang="cs" data-variant={site.theme.variant}>
      <body>{children}</body>
    </html>
  )
}
