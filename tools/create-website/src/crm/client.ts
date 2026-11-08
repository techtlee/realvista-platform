/**
 * CRM client for /create-website (C1/C2/C3).
 *
 * Auth, in order (A5): `CW_CRM_API_KEY` env, then `crm.apiKeyFile`
 * (`seed:provisioner` output, dotenv `CW_CRM_API_KEY=…`, `CW_CRM_EMAIL=…`),
 * then `crm.credentialsFile` — by default `./crm/.env.provisioner.local`, so
 * an API key there is used directly; a file with CRM_STAFF_/CRM_ADMIN_
 * EMAIL+PASSWORD logs in instead. The JWT lives in memory only.
 *
 * The skill only reads leads/sites and appends to provisioning logs; it never
 * converts, wins or creates CRM records (those are staff decisions).
 */
import { existsSync, readFileSync } from 'node:fs'

import type { Redactor } from '../redact.js'
import { dotenvToRecord } from '../secrets.js'
import { CwError, type Config, type CrmOutboxEntry, type Http, type HttpResponse, type Json } from '../types.js'

export interface CrmSite {
  id: number
  slug: string
  status: string
}

export type AppendOutcome = { appended: boolean }

export class CrmClient {
  private authHeader: string | null = null

  constructor(
    readonly url: string,
    private readonly http: Http,
    private readonly auth: { apiKey?: string; apiKeyFile?: string; credentialsFile?: string },
    private readonly redactor?: Redactor,
  ) {}

  static fromConfig(cfg: Config, http: Http, redactor?: Redactor, env: NodeJS.ProcessEnv = process.env): CrmClient | null {
    if (!cfg.crm) return null
    return new CrmClient(
      cfg.crm.url,
      http,
      {
        ...(env.CW_CRM_API_KEY ? { apiKey: env.CW_CRM_API_KEY } : {}),
        ...(cfg.crm.apiKeyFile ? { apiKeyFile: cfg.crm.apiKeyFile } : {}),
        ...(cfg.crm.credentialsFile ? { credentialsFile: cfg.crm.credentialsFile } : {}),
      },
      redactor,
    )
  }

  private async call(method: 'GET' | 'POST', path: string, body?: Json): Promise<HttpResponse> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    try {
      headers.authorization = await this.authorization()
      return await this.http.request({
        method,
        url: `${this.url}${path}`,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        timeoutMs: 10_000,
      })
    } catch (e) {
      if (e instanceof CwError) throw e
      throw new CwError('CRM_UNREACHABLE', `CRM at ${this.url} is unreachable: ${(e as Error).message}`, {
        hint: 'Start the dev CRM (port 3003) or retry later; `cw report-crm <slug>` flushes the log afterwards.',
      })
    }
  }

  private async authorization(): Promise<string> {
    if (this.authHeader) return this.authHeader
    let key = this.auth.apiKey
    if (!key && this.auth.apiKeyFile && existsSync(this.auth.apiKeyFile)) {
      key = dotenvToRecord(readFileSync(this.auth.apiKeyFile, 'utf8')).CW_CRM_API_KEY
    }
    if (key) {
      this.redactor?.add(key)
      if (this.auth.apiKeyFile && existsSync(this.auth.apiKeyFile)) {
        const email = dotenvToRecord(readFileSync(this.auth.apiKeyFile, 'utf8')).CW_CRM_EMAIL
        if (email) this.redactor?.add(email)
      }
      this.authHeader = `users API-Key ${key}`
      return this.authHeader
    }
    if (this.auth.credentialsFile && existsSync(this.auth.credentialsFile)) {
      const c = dotenvToRecord(readFileSync(this.auth.credentialsFile, 'utf8'))
      // the default credentials file is seed:provisioner's key file (CW3)
      if (c.CW_CRM_API_KEY) {
        this.redactor?.add(c.CW_CRM_API_KEY)
        if (c.CW_CRM_EMAIL) this.redactor?.add(c.CW_CRM_EMAIL)
        this.authHeader = `users API-Key ${c.CW_CRM_API_KEY}`
        return this.authHeader
      }
      const email = c.CRM_STAFF_EMAIL ?? c.CRM_ADMIN_EMAIL
      const password = c.CRM_STAFF_PASSWORD ?? c.CRM_ADMIN_PASSWORD
      if (email && password) {
        this.redactor?.add(password)
        const res = await this.http.request({
          method: 'POST',
          url: `${this.url}/api/users/login`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
          timeoutMs: 10_000,
        })
        const token = res.status === 200 ? (safeJson(res.text) as { token?: string } | null)?.token : undefined
        if (!token) throw new CwError('CRM_UNREACHABLE', `CRM login as ${email} failed (HTTP ${res.status})`)
        this.redactor?.add(token)
        this.authHeader = `JWT ${token}`
        return this.authHeader
      }
    }
    throw new CwError('PRECONDITION', 'no CRM credentials: set CW_CRM_API_KEY, crm.apiKeyFile or crm.credentialsFile', {
      hint: 'Run `pnpm seed:provisioner` in crm and point crm.apiKeyFile at .env.provisioner.local.',
    })
  }

  /** C1. 422 → CRM_UNQUALIFIED listing the missing fields; 409 → CRM_NO_SITE. Returns the raw envelope (validate it yourself). */
  async getProvisioningRequest(leadId: number): Promise<unknown> {
    const res = await this.call('GET', `/api/leads/${encodeURIComponent(String(leadId))}/provisioning-request`)
    const body = safeJson(res.text) as Record<string, unknown> | null
    if (res.status === 200 && body) return body
    if (res.status === 422) {
      const missing = Array.isArray(body?.missing) ? (body!.missing as string[]) : []
      throw new CwError('CRM_UNQUALIFIED', `lead ${leadId} is not qualified yet; missing: ${missing.join(', ') || '(not listed)'}`, {
        hint: 'Finish the qualification in the CRM, then retry. Do not edit the lead from here.',
        details: { missing },
      })
    }
    if (res.status === 409) {
      throw new CwError('CRM_NO_SITE', `lead ${leadId} has no site record yet`, { hint: 'Create the site in the CRM first (runbook step 3).' })
    }
    if (res.status === 404) throw new CwError('NOT_FOUND', `lead ${leadId} not found in the CRM at ${this.url}`)
    if (res.status === 401 || res.status === 403) throw new CwError('PRECONDITION', `CRM refused the provisioner credentials (HTTP ${res.status})`)
    throw new CwError('CRM_UNREACHABLE', `CRM answered HTTP ${res.status} for lead ${leadId}`)
  }

  async getSite(siteId: number): Promise<CrmSite> {
    const res = await this.call('GET', `/api/sites/${encodeURIComponent(String(siteId))}?depth=0`)
    if (res.status === 404) throw new CwError('NOT_FOUND', `site ${siteId} not found in the CRM`)
    if (res.status !== 200) throw new CwError('CRM_UNREACHABLE', `CRM answered HTTP ${res.status} for site ${siteId}`)
    const b = safeJson(res.text) as { id: number; slug: string; status: string } | null
    if (!b) throw new CwError('CRM_UNREACHABLE', `CRM sent a non-JSON site ${siteId}`)
    return { id: b.id, slug: b.slug, status: b.status }
  }

  /** C2: append one entry; the server dedupes on key (201 appended / 200 already there). */
  async appendLog(siteId: number, e: Pick<CrmOutboxEntry, 'key' | 'step' | 'status' | 'at' | 'detail'>, runId: string): Promise<AppendOutcome> {
    const res = await this.call('POST', `/api/sites/${encodeURIComponent(String(siteId))}/provisioning-log`, {
      key: e.key,
      runId,
      step: e.step,
      status: e.status,
      at: e.at,
      detail: e.detail.slice(0, 4000),
    })
    if (res.status === 201) return { appended: true }
    if (res.status === 200) return { appended: false } // already logged: not an error
    if (res.status === 404) throw new CwError('NOT_FOUND', `CRM site ${siteId} not found while logging ${e.key}`)
    if (res.status === 400) {
      const issues = (safeJson(res.text) as { issues?: Array<{ path: string; message: string }> } | null)?.issues ?? []
      throw new CwError('INVALID_INPUT', `CRM rejected log entry ${e.key}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ') || 'HTTP 400'}`)
    }
    throw new CwError('CRM_UNREACHABLE', `CRM refused log entry ${e.key}: HTTP ${res.status}`)
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
