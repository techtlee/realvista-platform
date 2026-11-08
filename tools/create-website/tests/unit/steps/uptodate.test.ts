import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { upToDate } from '../../../src/steps/util.js'
import type { Ctx } from '../../../src/types.js'
import { makeWorld, type World } from './helpers.js'

let w: World
beforeEach(() => {
  w = makeWorld()
})
afterEach(() => w.cleanup())

const step = (probe: 'done' | 'absent', fp: string) => ({
  id: 'site-standalone' as const,
  probe: async (_: Ctx) => ({ state: probe }),
  fingerprint: () => fp,
})

describe('upToDate (run() idempotency guard)', () => {
  it('a finished world that this step never recorded is up to date (exporter made the commit)', async () => {
    expect(await upToDate(w.ctx, step('done', 'a'))).toBe(true)
  })
  it('same fingerprint as the last success: up to date', async () => {
    w.state.patchStep('site-standalone', { status: 'done', fingerprint: 'a' })
    expect(await upToDate(w.ctx, step('done', 'a'))).toBe(true)
  })
  it('inputs changed since the last success: must re-apply', async () => {
    w.state.patchStep('site-standalone', { status: 'done', fingerprint: 'a' })
    expect(await upToDate(w.ctx, step('done', 'b'))).toBe(false)
  })
  it('world incomplete: must run', async () => {
    expect(await upToDate(w.ctx, step('absent', 'a'))).toBe(false)
  })
})
