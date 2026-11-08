import type { SiteSettings } from '@makleri/core/content'
import type { ReactNode } from 'react'

import site from '../site.config'
import { Container, Footer, Header } from './theme'

/**
 * A plain text page in the theme's chrome: legal texts and the thank-you page.
 *
 * These are routes the client repo owns rather than theme pages, so they borrow
 * the theme's Header and Footer instead of a page component from the contract.
 */
export function TextPage({
  settings,
  title,
  children,
}: {
  settings: SiteSettings | null
  title: string
  children: ReactNode
}) {
  return (
    <>
      <Header settings={settings} site={site} />
      <main className="py-[90px]">
        <Container>
          <h1 className="max-w-[860px] text-[46px] font-medium leading-[54px] text-brand">{title}</h1>
          <div className="mt-10 max-w-[860px] text-[16px] leading-[26px] text-brand">{children}</div>
        </Container>
      </main>
      <Footer settings={settings} site={site} />
    </>
  )
}

/**
 * Shown while the realtor has not filled a legal text in yet.
 *
 * The footer links these pages on every site, so a 404 is not an option; an
 * honest placeholder with the office's contact details is the next best thing.
 */
export function MissingText({ settings }: { settings: SiteSettings | null }) {
  const c = settings?.contact
  return (
    <p>
      Tento text pro web zatím připravujeme.
      {c?.email || c?.phone ? (
        <>
          {' '}
          S dotazy se na nás obraťte {c.email ? <>e-mailem na {c.email}</> : null}
          {c.email && c.phone ? ' nebo ' : null}
          {c.phone ? <>na telefonu {c.phone}</> : null}.
        </>
      ) : null}
    </p>
  )
}
