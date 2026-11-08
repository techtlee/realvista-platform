import type { Metadata } from 'next'

import { cms } from '../cms'
import { MissingText, TextPage } from '../TextPage'
import { RichText } from '../theme'

export const revalidate = 3600

export const metadata: Metadata = { title: 'Cookies' }

export default async function CookiesPage() {
  const settings = await cms.getSiteSettings()
  const text = settings?.legal?.cookieNotice

  return (
    <TextPage settings={settings} title="Informace o cookies">
      {text ? <RichText value={text} /> : <MissingText settings={settings} />}
    </TextPage>
  )
}
