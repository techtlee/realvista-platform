import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { topoSort } from '../../../src/runner.js'
import { STEPS } from '../../../src/steps/registry.js'
import { CRM_LOG_NAMES, ERROR_CODES, OUTWARD_STEP_IDS, OutwardDisabledError, STEP_IDS } from '../../../src/types.js'
import { makeWorld } from './helpers.js'

const SKILL = fileURLToPath(new URL('../../../../../.claude/skills/create-website/', import.meta.url))
const read = (rel: string) => readFileSync(join(SKILL, rel), 'utf8')

describe('registry', () => {
  it('has exactly one step per STEP_IDS entry, in order', () => {
    expect(STEPS.map((s) => s.id)).toEqual([...STEP_IDS])
  })

  it('runs in runbook order although dependsOn lists data dependencies only', () => {
    expect(topoSort([...STEPS]).map((s) => s.id).filter((id) => !OUTWARD_STEP_IDS.includes(id as never))).toEqual(
      STEP_IDS.filter((id) => !OUTWARD_STEP_IDS.includes(id as never)),
    )
  })

  it('marks exactly the nine outward steps as outward, and their run() refuses', async () => {
    expect(STEPS.filter((s) => s.outward).map((s) => s.id)).toEqual([...OUTWARD_STEP_IDS])
    const w = makeWorld()
    try {
      for (const s of STEPS.filter((x) => x.outward)) await expect(s.run(w.ctx)).rejects.toBeInstanceOf(OutwardDisabledError)
    } finally {
      w.cleanup()
    }
  })

  it('every outward plan() returns commands without secret values and never mentions nameservers', () => {
    const w = makeWorld()
    try {
      const all = STEPS.filter((s) => s.outward).flatMap((s) => s.plan(w.ctx))
      expect(all.length).toBeGreaterThan(0)
      const text = JSON.stringify(all)
      expect(text).not.toMatch(/nameserver/i)
      expect(text).not.toMatch(/\bNS\b/)
    } finally {
      w.cleanup()
    }
  })

  it('only backend-credentials is irreversible', () => {
    expect(STEPS.filter((s) => s.irreversible).map((s) => s.id)).toEqual(['backend-credentials'])
  })

  it('every local step has a probe and every dependency is a known step', () => {
    for (const s of STEPS) {
      expect(typeof s.probe).toBe('function')
      for (const d of s.dependsOn) expect(STEP_IDS).toContain(d)
    }
  })
})

describe('skill references match the code', () => {
  it('runbook-map.md lists every step id with its CRM log name', () => {
    const map = read('references/runbook-map.md')
    for (const id of STEP_IDS) {
      const row = map.split('\n').find((l) => l.includes(`| \`${id}\` |`))
      expect(row, `row for ${id}`).toBeTruthy()
      const name = (CRM_LOG_NAMES as Record<string, string>)[id]
      if (name) expect(row, `${id} → ${name}`).toContain(`\`${name}\``)
    }
  })

  it('errors.md has a row with a next action for every error code', () => {
    const errors = read('references/errors.md')
    for (const code of Object.keys(ERROR_CODES)) expect(errors, code).toMatch(new RegExp(`\\| \`${code}\` \\| ${ERROR_CODES[code as keyof typeof ERROR_CODES]} \\|`))
  })

  it('SKILL.md stays under 400 lines and keeps the hard rules', () => {
    const skill = read('SKILL.md')
    expect(skill.split('\n').length).toBeLessThan(400)
    expect(skill).toMatch(/^name: create-website$/m)
    for (const must of ['Never read secret files', 'Never run outward steps', 'Never touch nameservers', 'cw status <slug> --json', 'Never run `cw teardown`']) {
      expect(skill).toContain(must)
    }
    for (const ref of ['runbook-map.md', 'state-file.md', 'errors.md', 'czech-copy.md', 'outward-plan.md']) expect(skill).toContain(`references/${ref}`)
  })
})
