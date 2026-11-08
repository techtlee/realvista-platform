import type { EnquiryInput } from '@makleri/core/content'

import site from '../../../site.config'
import { cms } from '../../cms'

/**
 * The site's contact form, posted as a plain HTML form.
 *
 * No JavaScript on the page: the theme's `ContactSection` posts here and the
 * browser follows a 303 to the thank-you page. That keeps the form working on
 * every phone and keeps the theme a set of Server Components.
 *
 * The CMS stores what the visitor wrote and the consent wording they saw, so
 * the text is read from the same site settings the form rendered — a consent
 * record holding different words than the checkbox showed is worthless.
 */

/** Must match the theme's fallback label next to the checkbox. */
const DEFAULT_CONSENT_TEXT = 'Souhlasím se zpracováním osobních údajů'

/**
 * Hidden field a person never fills in and a naive bot always does. The
 * theme's ContactSection renders it off-screen.
 */
const HONEYPOT = 'website'

const LIMITS = { name: 200, email: 254, phone: 40, message: 5000 } as const

function field(form: FormData, name: string, max: number): string | undefined {
  const value = form.get(name)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed === '' ? undefined : trimmed
}

/** Path of the page the form was sent from, if it is this site; for `source`. */
function sourcePath(req: Request): string | undefined {
  const referer = req.headers.get('referer')
  if (!referer) return undefined
  try {
    const from = new URL(referer)
    return from.origin === new URL(req.url).origin ? from.pathname : undefined
  } catch {
    return undefined
  }
}

function redirectTo(req: Request, query = ''): Response {
  // 303, not 307: the browser must GET the thank-you page, not re-POST to it.
  return Response.redirect(new URL(`/poptavka-odeslana${query}`, req.url), 303)
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  if (!form) return redirectTo(req, '?chyba=1')

  // Pretend success: telling a bot it was caught only teaches it.
  if (field(form, HONEYPOT, 1)) return redirectTo(req)

  const name = field(form, 'name', LIMITS.name)
  const email = field(form, 'email', LIMITS.email)
  const phone = field(form, 'phone', LIMITS.phone)
  const message = field(form, 'message', LIMITS.message)
  const propertyId = field(form, 'propertyId', 20)
  const consentGiven = form.get('consent') != null

  // The browser enforces these via `required`; this is for everything else.
  // Without consent there is no lawful basis to store the rest of it at all.
  if (!name || !consentGiven || (!email && !phone)) return redirectTo(req, '?chyba=1')

  const settings = await cms.getSiteSettings().catch(() => null)

  // `tenant` is not part of EnquiryInput, but the CMS rejects an enquiry
  // without one: the multi-tenant plugin stamps it from the admin's tenant
  // cookie, which an API-key request does not carry. `submitEnquiry` spreads
  // the input into the body, so it passes through. Remove once core's client
  // sends its own tenantId (requested from the core owner).
  const input: EnquiryInput & { tenant: number | string } = {
    tenant: site.cms.tenantId,
    name,
    email,
    phone,
    message,
    propertyId: propertyId && /^\d+$/.test(propertyId) ? Number(propertyId) : undefined,
    source: sourcePath(req),
    consent: {
      given: true,
      text: settings?.legal?.gdprConsentText ?? DEFAULT_CONSENT_TEXT,
    },
  }

  try {
    await cms.submitEnquiry(input)
  } catch (err) {
    // Logged server-side only; the visitor gets the phone number instead.
    console.error('[poptavka] enquiry not stored', err)
    return redirectTo(req, '?chyba=1')
  }

  return redirectTo(req)
}
