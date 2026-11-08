import { describe, expect, it } from 'vitest'

import {
  outwardInput,
  outwardInputFromCtx,
  renderOutwardPlanJson,
  renderOutwardPlanMarkdown,
  shellQuote,
} from '../../src/outward/index.js'
import type { Ctx } from '../../src/types.js'
import { noDomainRequest, novakRequest } from './fixtures.js'

const novak = outwardInput({ request: novakRequest(), subdomainBase: 'realvista.cz' })
const md = renderOutwardPlanMarkdown(novak)
const json = JSON.stringify(renderOutwardPlanJson(novak), null, 2)

/** A delegation change, in any spelling the plan could use. */
const DELEGATION = /\bNS\b|\bSOA\b|name-?servers?|jmenn[éý] server/i

describe('outward-plan for novak-test', () => {
  it('matches the golden file (runbook 13–19 with OWNER/TEAM placeholders)', async () => {
    await expect(md).toMatchFileSnapshot('./__snapshots__/novak-test.outward-plan.md')
    await expect(json).toMatchFileSnapshot('./__snapshots__/novak-test.outward-plan.json')
  })

  it('covers runbook steps 13 to 19', () => {
    for (const n of ['13', '14', '15', '16', '17', '18', '19']) expect(md).toMatch(new RegExp(`^## ${n}\\. `, 'm'))
  })

  it('contains the commands the eval checks for', () => {
    expect(md).toContain('gh repo create OWNER/backend-novak-test')
    expect(md).toContain('vercel link --yes --project site-novak-test --scope TEAM')
  })

  it('never mentions a delegation record or a nameserver change', () => {
    expect(md).not.toMatch(DELEGATION)
    expect(json).not.toMatch(DELEGATION)
  })

  it('has DNS records of type A and CNAME only, for the apex, www and admin', () => {
    const plan = renderOutwardPlanJson(novak) as { steps: { step: string; records: { type: string; host: string }[] }[] }
    const records = plan.steps.flatMap((s) => s.records)
    expect(records.map((r) => r.type).every((t) => t === 'A' || t === 'CNAME')).toBe(true)
    const client = plan.steps.find((s) => s.step === 'client-dns')?.records ?? []
    expect(client.map((r) => r.host)).toEqual(['novak-test.cz', 'www.novak-test.cz', 'admin.novak-test.cz'])
  })

  it('contains no secret values, only references', () => {
    for (const text of [md, json]) {
      expect(text).not.toMatch(/\b[A-Z_]*(KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL)=(?!\$)[^\s'"]/)
      expect(text).not.toMatch(/postgres(ql)?:\/\//)
      expect(text).not.toMatch(/\b[a-f0-9]{32,}\b/i)
      expect(text).not.toMatch(/users API-Key/)
    }
    expect(md).toContain('cw secret-pipe novak-test backend/.env.production.local DATABASE_URL | vercel env add DATABASE_URL production')
  })

  it('says outward is disabled and nothing has been run', () => {
    expect(md).toContain('**Nothing below has been run**')
    expect(JSON.parse(json).outwardEnabled).toBe(false)
  })
})

describe('no secrets leak in from the engine context', () => {
  it('outwardInputFromCtx reads only the request, config and paths', () => {
    const planted = ['s3cr3t-payload-value-0123456789abcdef', 'postgres://u:pw@db/x']
    const ctx = {
      cfg: { rootDir: '/tmp/cw-root', subdomainBase: 'realvista.cz' },
      request: novakRequest(),
      paths: {
        record: '/tmp/cw-root/clients/novak-test',
        backend: '/tmp/cw-root/clients/backend-novak-test',
        site: '/tmp/cw-root/clients/site-novak-test',
      },
      secrets: {
        knownValues: () => planted,
        get: async () => planted[0],
      },
    } as unknown as Ctx
    const input = outwardInputFromCtx(ctx)
    expect(input.dirs).toEqual(novak.dirs)
    const text = renderOutwardPlanMarkdown(input) + JSON.stringify(renderOutwardPlanJson(input))
    for (const v of planted) expect(text).not.toContain(v)
    expect(text).toBe(md + JSON.stringify(renderOutwardPlanJson(novak)))
  })
})

describe('a client with no domain', () => {
  const i = outwardInput({ request: noDomainRequest(), subdomainBase: 'realvista.cz' })
  const text = renderOutwardPlanMarkdown(i)

  it('plans fallback addresses only, and still no delegation', () => {
    expect(text).toContain('vercel domains add svoboda-reality.realvista.cz site-svoboda-reality --scope TEAM')
    expect(text).not.toMatch(/novak-test/)
    expect(text).not.toMatch(DELEGATION)
    expect(text).not.toMatch(/^```\n.*\bA\b\s+76\.76\.21\.21/m)
  })
})

describe('shellQuote', () => {
  it.each([
    ['plain-arg', 'plain-arg'],
    ['OWNER/site-x', 'OWNER/site-x'],
    ['.connection_uris[0].connection_uri', "'.connection_uris[0].connection_uri'"],
    ["it's", "'it'\\''s'"],
    ['a b', "'a b'"],
  ])('%s → %s', (input, out) => {
    expect(shellQuote(input)).toBe(out)
  })
})
