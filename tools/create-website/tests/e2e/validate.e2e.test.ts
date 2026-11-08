/**
 * `cw validate` contract over every request fixture (fixtures/requests/expectations.json):
 * exit code, the issue path, the catalog's own message, the bare-JSON + flags
 * path producing the same envelope as a file, and that validate creates nothing.
 * Fast: no Postgres, no network.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { FIXTURES, cw, databases, destroyRoot, explain, makeRoot } from './helpers.js'

const EXPECT = JSON.parse(readFileSync(join(FIXTURES, 'expectations.json'), 'utf8')) as Record<string, any>
const root = makeRoot({ site: [4184, 4185], backend: [4284, 4285] })
afterAll(async () => {
  await destroyRoot(root)
})

const entries = Object.entries(EXPECT).filter(([k]) => !k.startsWith('$'))

function inputArgs(file: string, e: any): string[] {
  const p = join(FIXTURES, file)
  return e.bare ? ['--json', p, ...(e.flags ?? [])] : ['--request', p]
}

/** Collect issue paths from whatever shape the CLI uses (issues[].path as string or array). */
function issuePaths(json: any): string[] {
  const issues = json?.issues ?? json?.details?.issues ?? []
  return issues.map((i: any) => (Array.isArray(i.path) ? i.path.join('.') : String(i.path ?? ''))).map((p: string) => (p === '(root)' ? '' : p))
}

describe('cw validate over the fixtures', () => {
  it.each(entries)('%s', (file, e) => {
    const r = cw(root, ['validate', ...inputArgs(file, e)], {}, 120_000)
    if (e.valid) {
      expect(r.code, explain(r)).toBe(0)
      expect(r.json?.ok).toBe(true)
      return
    }
    expect(r.code, explain(r)).toBe(e.exit ?? 2)
    expect(r.json?.ok).toBe(false)
    if (e.code) expect(r.json?.code).toBe(e.code)
    const paths = issuePaths(r.json)
    // envelope paths are reported with or without the "provisioning." prefix for bare JSON
    const want = e.issuePath as string
    expect(paths.some((p) => p === want || `provisioning.${p}` === want || p === `provisioning.${want}`), `paths ${JSON.stringify(paths)} want ${want}\n${explain(r)}`).toBe(true)
    for (const s of e.messageIncludes ?? []) expect(r.stdout, s).toContain(s)
  })

  it('bare JSON + --slug/--contact-* builds the same envelope sha as the equivalent request file', () => {
    const e = EXPECT['svoboda-friendly-indigo.provisioning.json']
    const a = cw(root, ['validate', ...inputArgs('svoboda-friendly-indigo.provisioning.json', e)], {}, 120_000)
    const b = cw(root, ['validate', '--request', join(FIXTURES, e.sameShaAs)], {}, 120_000)
    expect(a.code, explain(a)).toBe(0)
    expect(b.code, explain(b)).toBe(0)
    const sha = (j: any) => j?.requestSha256 ?? j?.input?.requestSha256
    expect(sha(a.json), JSON.stringify(a.json)).toBeTruthy()
    expect(sha(a.json)).toBe(sha(b.json))
  })

  it('validate never creates anything', () => {
    expect(readdirSync(root.clients)).toEqual([])
    expect(databases(root)).toEqual([])
  })

  it('cw plan --outward executes nothing and prints the runbook 13-19 commands', () => {
    const r = cw(root, ['plan', '--request', join(FIXTURES, 'svoboda-friendly-indigo.request.json'), '--outward'], {}, 120_000)
    expect(r.code, explain(r)).toBe(0)
    expect(r.stdout).toMatch(/gh repo create/)
    expect(r.stdout).toMatch(/vercel link/)
    expect(r.stdout).not.toMatch(/(^|[\s"|])NS(\s|")/)
    expect(readdirSync(root.clients)).toEqual([])
    expect(databases(root)).toEqual([])
  })
})
