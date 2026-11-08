import type { Metadata } from 'next'

import { cms } from '../cms'
import { TextPage } from '../TextPage'

/** Where `/api/poptavka` sends the visitor. Not worth indexing. */
export const metadata: Metadata = { title: 'Poptávka', robots: { index: false } }

export default async function EnquirySentPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string }>
}) {
  const [{ chyba }, settings] = await Promise.all([searchParams, cms.getSiteSettings()])
  const c = settings?.contact

  if (chyba) {
    return (
      <TextPage settings={settings} title="Poptávku se nepodařilo odeslat">
        <p>
          Omlouváme se, zprávu se nepodařilo uložit. Zkontrolujte prosím, že jste vyplnili jméno, e-mail
          a souhlas se zpracováním údajů, a zkuste to znovu.
        </p>
        {c?.phone || c?.email ? (
          <p className="mt-4">
            Případně nás kontaktujte přímo{c.phone ? <>: {c.phone}</> : null}
            {c.phone && c.email ? ', ' : c.email ? ': ' : null}
            {c.email ?? null}.
          </p>
        ) : null}
        <p className="mt-8">
          <a href="/#kontakt" className="underline">Zpět na formulář</a>
        </p>
      </TextPage>
    )
  }

  return (
    <TextPage settings={settings} title="Děkujeme, poptávku jsme přijali">
      <p>Ozveme se vám co nejdříve, obvykle do jednoho pracovního dne.</p>
      <p className="mt-8">
        <a href="/" className="underline">Zpět na úvodní stránku</a>
      </p>
    </TextPage>
  )
}
