import { describe, expect, it } from 'vitest'

import {
  OUTWARD_ADAPTERS,
  outwardAdapter,
  outwardInput,
  PRODUCTION_SECRET_FILES,
  toPlannedCommand,
  type OutwardCommand,
} from '../../src/outward/index.js'
import { OUTWARD_ENABLED, OUTWARD_STEP_IDS, OutwardDisabledError } from '../../src/types.js'
import { noDomainRequest, novakRequest } from './fixtures.js'

const novak = outwardInput({ request: novakRequest(), subdomainBase: 'realvista.cz' })
const noDomain = outwardInput({ request: noDomainRequest(), subdomainBase: 'realvista.cz' })
const allCommands = (i = novak): OutwardCommand[] => OUTWARD_ADAPTERS.flatMap((a) => a.plan(i).commands)

describe('outward adapters', () => {
  it('one per outward step id, in runbook order', () => {
    expect(OUTWARD_ADAPTERS.map((a) => a.step)).toEqual([...OUTWARD_STEP_IDS])
    for (const id of OUTWARD_STEP_IDS) expect(outwardAdapter(id).step).toBe(id)
  })

  it('outward is disabled at compile time', () => {
    expect(OUTWARD_ENABLED).toBe(false)
  })

  it.each(OUTWARD_ADAPTERS.map((a) => [a.step, a] as const))('%s: apply() throws OutwardDisabledError', async (_, a) => {
    await expect(a.apply(novak)).rejects.toBeInstanceOf(OutwardDisabledError)
    await expect(a.apply(novak)).rejects.toMatchObject({ code: 'OUTWARD_REFUSED' })
  })

  it('plan() is pure: same input, same plan', () => {
    for (const a of OUTWARD_ADAPTERS) expect(a.plan(novak)).toEqual(a.plan(novak))
  })

  it('command ids are unique across the whole plan', () => {
    const ids = allCommands().map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only ever names the tools of runbook 13–19, plus cw and pnpm', () => {
    const tools = new Set(allCommands().map((c) => c.argv[0]))
    expect([...tools].sort()).toEqual(['cw', 'gh', 'neonctl', 'pnpm', 'vercel'])
  })

  it('never names a local dev secret file: production values are new values', () => {
    const files = allCommands().flatMap((c) => [
      ...(c.envFrom ?? []),
      ...(c.stdin?.kind === 'secret' ? [c.stdin.file] : []),
      ...(c.captureTo ? [c.captureTo.file] : []),
    ])
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(PRODUCTION_SECRET_FILES).toContain(f)
    expect(JSON.stringify(allCommands())).not.toMatch(/admin-credentials\.local|\.env\.local"|backend\/\.env"/)
  })

  it('production secret files are covered by the templates\' `.env*.local` ignore rule', () => {
    for (const f of PRODUCTION_SECRET_FILES) expect(f.split('/')[1]).toMatch(/^\.env.*\.local$/)
    const keyOut = allCommands().find((c) => c.id === 'vercel-env:seed:seed:site-key')?.env?.SITE_KEY_OUT
    expect(keyOut).toMatch(/^\.env.*\.local$/)
  })

  it('carries secrets only as references: no inline value looks like one', () => {
    for (const c of allCommands()) {
      if (c.stdin?.kind === 'value') expect(c.stdin.value).toMatch(/^(realvista\.cz|https:\/\/[a-z0-9.-]+)$/)
      for (const v of Object.values(c.env ?? {})) expect(v).not.toMatch(/^[A-Za-z0-9+/=_-]{24,}$/)
    }
  })
})

describe('github-repos (13)', () => {
  it('creates backend first, each guarded by gh repo view', () => {
    const cmds = outwardAdapter('github-repos').plan(novak).commands
    expect(cmds.map((c) => c.argv.slice(0, 4))).toEqual([
      ['gh', 'repo', 'create', 'OWNER/backend-novak-test'],
      ['gh', 'repo', 'create', 'OWNER/site-novak-test'],
    ])
    expect(cmds[0]?.idempotencyProbe).toEqual(['gh', 'repo', 'view', 'OWNER/backend-novak-test'])
    expect(cmds[0]?.argv).toContain('--public')
  })
})

describe('vercel-env (15)', () => {
  const cmds = outwardAdapter('vercel-env').plan(novak).commands
  const order = (id: string) => cmds.findIndex((c) => c.id === id)

  it('backend deploy and seed come before the site env and deploy (F11)', () => {
    expect(order('vercel-env:backend:deploy')).toBeLessThan(order('vercel-env:seed:seed:admin'))
    expect(order('vercel-env:seed:seed:site-key')).toBeLessThan(order('vercel-env:site:CMS_API_KEY'))
    expect(order('vercel-env:site:CMS_API_KEY')).toBeLessThan(order('vercel-env:site:deploy'))
  })

  it('always passes CMS_PROBE_URL to seed:site-key (B4), pointing at production', () => {
    const c = cmds.find((x) => x.id === 'vercel-env:seed:seed:site-key')
    expect(c?.env?.CMS_PROBE_URL).toBe('https://admin.novak-test.realvista.cz')
  })

  it('seeds content from the request envelope, relative to the backend dir', () => {
    const c = cmds.find((x) => x.id === 'vercel-env:seed:seed:client-site')
    expect(c?.env?.PROVISIONING_REQUEST).toBe('../novak-test/provisioning-request.json')
    expect(c?.env?.SITE_URL).toBe('https://novak-test.realvista.cz')
  })

  it('takes the production TENANT_ID from the seed output, not the local one', () => {
    expect(cmds.find((x) => x.id === 'vercel-env:site:TENANT_ID')?.stdin).toEqual({ kind: 'shell-var', name: 'TENANT_ID' })
  })
})

describe('deploy-hook', () => {
  it('is not needed (ISR) and plans nothing', () => {
    const p = outwardAdapter('deploy-hook').plan(novak)
    expect(p.commands).toEqual([])
    expect(p.notNeeded).toMatch(/ISR/)
  })
})

describe('client-dns (17)', () => {
  it('has no executable command, only instructions and three records', () => {
    const p = outwardAdapter('client-dns').plan(novak)
    expect(p.commands).toEqual([])
    expect(p.records?.map((r) => `${r.type} ${r.host}`)).toEqual([
      'A novak-test.cz',
      'CNAME www.novak-test.cz',
      'CNAME admin.novak-test.cz',
    ])
    expect(p.summary).toContain('wedos')
    expect(p.instructions.join(' ')).toMatch(/MX/)
  })

  it('without a domain: no records, no commands, fallback addresses named', () => {
    const p = outwardAdapter('client-dns').plan(noDomain)
    expect(p.commands).toEqual([])
    expect(p.records).toBeUndefined()
    expect(p.instructions.join(' ')).toContain('https://svoboda-reality.realvista.cz')
  })
})

describe('go-live (19)', () => {
  it('attaches the client domain, then makes both repos private', () => {
    const ids = outwardAdapter('go-live').plan(novak).commands.map((c) => c.id)
    expect(ids).toEqual([
      'go-live:domain:apex',
      'go-live:domain:www',
      'go-live:domain:admin',
      'go-live:private:backend',
      'go-live:private:site',
    ])
  })

  it('without a domain only makes the repos private', () => {
    const ids = outwardAdapter('go-live').plan(noDomain).commands.map((c) => c.id)
    expect(ids).toEqual(['go-live:private:backend', 'go-live:private:site'])
  })

  it('reminds to replace [NÁVRH] and [DOPLNIT] first', () => {
    expect(outwardAdapter('go-live').plan(novak).instructions[0]).toMatch(/\[NÁVRH\].*\[DOPLNIT\]/)
  })
})

describe('toPlannedCommand', () => {
  it('maps to the engine contract, with the production source in the note', () => {
    const c = outwardAdapter('vercel-env').plan(novak).commands.find((x) => x.id === 'vercel-env:backend:DATABASE_URL')
    const p = toPlannedCommand(novak, c as OutwardCommand)
    expect(p).toEqual({
      id: 'vercel-env:backend:DATABASE_URL',
      description: 'Set DATABASE_URL on the backend project (production)',
      argv: ['vercel', 'env', 'add', 'DATABASE_URL', 'production'],
      envNames: [],
      note: 'stdin: DATABASE_URL from backend/.env.production.local; run in clients/backend-novak-test',
    })
    expect(p.stdin).toBeUndefined()
  })

  it('lists the non-secret env names a command sets', () => {
    const c = outwardAdapter('vercel-env').plan(novak).commands.find((x) => x.id === 'vercel-env:seed:seed:site-key')
    expect(toPlannedCommand(novak, c as OutwardCommand).envNames).toEqual([
      'NODE_ENV',
      'TENANT_SLUG',
      'CMS_PROBE_URL',
      'SITE_KEY_OUT',
    ])
  })
})
