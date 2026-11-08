/**
 * A step registry for CLI tests: every local step drops a marker file in the
 * record dir; probe = marker present. Run counts are appended to
 * `<record>/runs.log` so tests can assert "ran once". CW_UNIT_FAIL=<stepId>
 * makes that step throw. backend-credentials writes real secrets through the
 * SecretStore and is irreversible.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { OUTWARD_STEP_IDS, STEP_IDS, type Ctx, type Step } from '../../../../src/types.js'

export function createSteps(): Step[] {
  const outward = new Set<string>(OUTWARD_STEP_IDS)
  return STEP_IDS.map((id, i) => {
    const marker = (ctx: Ctx) => join(ctx.paths.record, '.markers', id)
    const step: Step = {
      id,
      runbook: String(i + 1),
      phase: 'B',
      outward: outward.has(id),
      dependsOn: i === 0 ? [] : [STEP_IDS[i - 1]!],
      ...(id === 'backend-credentials' ? { irreversible: true } : {}),
      ...(id === 'crm-site-record' ? { skipReason: (ctx: Ctx) => (ctx.request.crm ? null : 'file input without CRM ids') } : {}),
      fingerprint: (ctx) => `fp:${id}:${id === 'input' ? ctx.state.get().input.requestSha256 : ''}`,
      probe: async (ctx) => (existsSync(marker(ctx)) ? { state: 'done' } : { state: 'absent' }),
      run: async (ctx) => {
        if (process.env.CW_UNIT_FAIL === id) throw new Error(`unit failure in ${id}`)
        mkdirSync(join(ctx.paths.record, '.markers'), { recursive: true })
        appendFileSync(join(ctx.paths.record, 'runs.log'), id + '\n')
        if (id === 'backend-credentials') {
          await ctx.secrets.ensure('backend/.admin-credentials.local', 'CLIENT_PASSWORD', () => ctx.secrets.generate())
          await ctx.secrets.ensure('backend/.admin-credentials.local', 'CLIENT_EMAIL', () => ctx.request.contact.email)
        }
        if (id === 'input') writeFileSync(join(ctx.paths.record, 'provisioning-request.json'), JSON.stringify(ctx.request, null, 2))
        writeFileSync(marker(ctx), '')
        return { marker: id }
      },
      plan: (ctx) => [{ id: `${id}-1`, description: id, argv: ['echo', id, ctx.state.get().slug], envNames: [] }],
    }
    return step
  })
}
