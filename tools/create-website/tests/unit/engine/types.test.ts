import { describe, expect, it } from 'vitest'

import {
  CRM_LOG_NAMES,
  ERROR_CODES,
  OUTWARD_ENABLED,
  OUTWARD_STEP_IDS,
  OutwardDisabledError,
  STEP_IDS,
  isStepId,
} from '../../../src/types.js'

describe('types contract', () => {
  it('lists every A2 step once, in table order', () => {
    expect(new Set(STEP_IDS).size).toBe(STEP_IDS.length)
    expect(STEP_IDS[0]).toBe('preflight')
    expect(STEP_IDS.indexOf('crm-report')).toBe(24)
    expect(STEP_IDS.slice(-2)).toEqual(['outward-plan', 'handover'])
    expect(isStepId('site-key')).toBe(true)
    expect(isStepId('rm-rf')).toBe(false)
  })

  it('outward steps are a contiguous block before outward-plan', () => {
    const start = STEP_IDS.indexOf('github-repos')
    expect(STEP_IDS.slice(start, start + OUTWARD_STEP_IDS.length)).toEqual([...OUTWARD_STEP_IDS])
  })

  it('maps CRM log names only for real step ids', () => {
    for (const id of Object.keys(CRM_LOG_NAMES)) expect(isStepId(id)).toBe(true)
  })

  it('keeps the outward kill switch off', () => {
    expect(OUTWARD_ENABLED).toBe(false)
    const err = new OutwardDisabledError('vercel-projects')
    expect(err.code).toBe('OUTWARD_REFUSED')
    expect(err.exitCode).toBe(7)
    expect(ERROR_CODES.STALE_IRREVERSIBLE).toBe(3)
  })
})
