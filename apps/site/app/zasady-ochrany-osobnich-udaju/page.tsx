import type { Metadata } from 'next'

import { cms } from '../cms'
import { MissingText, TextPage } from '../TextPage'
import { RichText } from '../theme'

export const revalidate = 3600

export const metadata: Metadata = { title: 'Zásady ochrany osobních údajů' }

export default async function PrivacyPolicyPage() {
  const settings = await cms.getSiteSettings()
  const text = settings?.legal?.privacyPolicy

  return (
    <TextPage settings={settings} title="Zásady ochrany osobních údajů">
      {text ? <RichText value={text} /> : <MissingText settings={settings} />}
    </TextPage>
  )
}
