/**
 * Input forms (A1): request envelope file, CRM lead id, or bare provisioning
 * JSON plus --slug/--contact-* flags. All three end as the same validated
 * ProvisioningRequest with the same sha, so the state file doesn't care
 * which door it came through.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { CrmClient } from '../crm/client.js'
import { sha256Json } from '../state/hash.js'
import { CwError, type InputSource, type Json, type ProvisioningRequest } from '../types.js'
import { buildProvisioningRequest, provisioningRequestSchema } from './schema.js'

export interface InputArgs {
  request?: string
  lead?: number
  json?: string
  slug?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  companyName?: string
  city?: string
}

export interface LoadedInput {
  source: InputSource
  path?: string
  leadId?: number
  raw: unknown
}

export interface Issue {
  path: string
  message: string
}

export interface ValidInput {
  request: ProvisioningRequest
  requestSha256: string
  provisioningSha256: string
}

function readJson(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    throw new CwError('INVALID_INPUT', `cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`)
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new CwError('INVALID_INPUT', `${path} is not valid JSON: ${(e as Error).message}`)
  }
}

export async function loadInput(a: InputArgs, o: { cwd?: string; crm?: CrmClient | null } = {}): Promise<LoadedInput> {
  const cwd = o.cwd ?? process.cwd()
  const forms = [a.request !== undefined, a.lead !== undefined, a.json !== undefined].filter(Boolean).length
  if (forms !== 1) {
    throw new CwError('INVALID_INPUT', 'give exactly one input: --request <file>, --lead <id>, or --json <file> --slug <s> --contact-name <n> --contact-email <e>')
  }
  if (a.request !== undefined) {
    const path = resolve(cwd, a.request)
    const raw = readJson(path)
    if (raw && typeof raw === 'object' && !('requestVersion' in raw) && 'schemaVersion' in raw) {
      throw new CwError('INVALID_INPUT', `${path} is a bare provisioning JSON, not a request envelope`, {
        hint: 'Pass it as --json with --slug, --contact-name and --contact-email, or download the request envelope from the CRM.',
      })
    }
    return { source: 'file', path, raw }
  }
  if (a.lead !== undefined) {
    if (!Number.isInteger(a.lead) || a.lead <= 0) throw new CwError('INVALID_INPUT', `--lead must be a positive integer`)
    if (!o.crm) throw new CwError('PRECONDITION', 'no CRM configured (crm.url in create-website.config.json)')
    const raw = await o.crm.getProvisioningRequest(a.lead)
    return { source: 'crm', leadId: a.lead, raw }
  }
  const path = resolve(cwd, a.json!)
  const provisioning = readJson(path)
  const missing = [!a.slug && '--slug', !a.contactName && '--contact-name', !a.contactEmail && '--contact-email'].filter(Boolean)
  if (missing.length) {
    throw new CwError('INVALID_INPUT', `a bare provisioning JSON needs ${missing.join(', ')}`, {
      hint: 'Propose a slug (slugifyCzech of the brand name) and ask Josef for the realtor contact.',
    })
  }
  const raw = buildProvisioningRequest({
    slug: a.slug!,
    contact: { name: a.contactName!, email: a.contactEmail!, phone: a.contactPhone ?? null },
    company: { name: a.companyName ?? null, city: a.city ?? null },
    provisioning,
  })
  return { source: 'bare-json', path, raw }
}

export function validateRequest(raw: unknown): { ok: true; value: ValidInput } | { ok: false; issues: Issue[] } {
  const r = provisioningRequestSchema.safeParse(raw)
  if (!r.success) {
    return {
      ok: false,
      issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })),
    }
  }
  const request = r.data as unknown as ProvisioningRequest
  return {
    ok: true,
    value: {
      request,
      requestSha256: sha256Json(request),
      provisioningSha256: sha256Json(request.provisioning),
    },
  }
}

/** Throws CwError INVALID_INPUT (exit 2) with the issues in `details`. */
export function validateOrThrow(raw: unknown): ValidInput {
  const r = validateRequest(raw)
  if (r.ok) return r.value
  const reserved = r.issues.some((i) => i.path === 'slug' && /reserved/i.test(i.message))
  throw new CwError(reserved ? 'RESERVED_SLUG' : 'INVALID_INPUT', `the request is invalid:\n${r.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`, {
    hint: 'Fix it at the source (the CRM lead/qualification), then download the request again; do not hand-edit the JSON.',
    details: r.issues as unknown as Json,
  })
}
