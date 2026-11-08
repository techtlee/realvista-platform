/**
 * CRM check/report, verify, the nine outward steps (plan only), the outward
 * plan file and the hand-over summary.
 */
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CrmClient } from '../crm/client.js'
import { flushOutbox } from '../crm/outbox.js'
import { outwardAdapter, outwardInputFromCtx, renderOutwardPlanJson, renderOutwardPlanMarkdown, toPlannedCommand } from '../outward/index.js'
import type { Redactor } from '../redact.js'
import type { Ctx, Json, OutwardStepId, Step } from '../types.js'
import { CwError, OUTWARD_STEP_IDS } from '../types.js'
import { runChecks } from '../verify/checks.js'
import { commitRecord } from './record.js'
import { fingerprintOf, hasStepCommit, outputs } from './util.js'

async function recordUpToDate(ctx: Ctx): Promise<boolean> {
  if (!(await hasStepCommit(ctx, ctx.paths.record, 'handover'))) return false
  const r = await ctx.exec.run(['git', 'status', '--porcelain', '--', '.', ':(exclude)create-website.state.json'], { cwd: ctx.paths.record, allowFailure: true })
  return r.code === 0 && r.stdout.trim() === ''
}

/** The CRM client, registering its credentials with the secret store's redaction. */
export function crmClient(ctx: Ctx): CrmClient | null {
  const redactor = { add: (v: string | undefined | null) => (v ? ctx.secrets.register(v) : undefined) } as unknown as Redactor
  return CrmClient.fromConfig(ctx.cfg, ctx.http, redactor)
}

export const crmSiteRecord: Step = {
  id: 'crm-site-record',
  runbook: '3 (check only)',
  phase: 'A',
  outward: false,
  dependsOn: ['input'],
  skipReason: (ctx) => (ctx.request.crm ? null : 'file input without a CRM lead; nothing to check'),
  fingerprint: (ctx) => fingerprintOf({ crm: ctx.request.crm ?? null, slug: ctx.request.slug }),
  // Read-only, so it always re-checks.
  probe: async () => ({ state: 'absent' }),
  async run(ctx) {
    const crm = ctx.request.crm!
    const client = crmClient(ctx)
    if (!client) throw new CwError('CONFIG_INVALID', 'the request names a CRM lead but the config has no `crm` section')
    const site = await client.getSite(crm.siteId)
    if (site.slug !== ctx.request.slug) {
      throw new CwError('SLUG_TAKEN', `CRM site ${crm.siteId} has slug "${site.slug}", the request says "${ctx.request.slug}"`, {
        hint: 'Download the request again from the CRM; never edit the slug locally.',
      })
    }
    if (site.status !== 'provisioning') ctx.log.warn(`CRM site ${crm.siteId} status is "${site.status}", expected "provisioning"`)
    return outputs({ siteId: site.id, slug: site.slug, status: site.status })
  },
  plan: () => [],
}

export const verify: Step = {
  id: 'verify',
  runbook: 'D',
  phase: 'D',
  crmLogName: 'verify',
  outward: false,
  // the revalidate round trip logs in as the realtor (checks.ts), so their login is an input
  dependsOn: ['site-start', 'backend-seed-realtor'],
  fingerprint: () => fingerprintOf({ v: 1 }),
  probe: async () => ({ state: 'absent' }),
  async run(ctx) {
    const results = await runChecks(ctx)
    ctx.state.update((s) => {
      s.verify = results
    })
    const failed = results.filter((r) => !r.ok)
    if (failed.length) {
      throw new CwError('STEP_FAILED', `verify: ${failed.length}/${results.length} check(s) failed: ${failed.map((f) => `${f.check} (${f.detail})`).join('; ')}`, {
        step: 'verify',
        hint: '`cw status` shows every check; fix the cause and `cw run` (or `cw verify`) again',
      })
    }
    return outputs({ passed: results.length, checks: results.map((r) => r.check) })
  },
  plan: () => [],
}

export const crmReport: Step = {
  id: 'crm-report',
  runbook: 'log',
  phase: 'D',
  outward: false,
  // after the outward steps, so their `skipped` entries go out in the same flush
  dependsOn: ['verify', ...OUTWARD_STEP_IDS],
  fingerprint: () => fingerprintOf({ v: 1 }),
  probe: async (ctx) => (ctx.state.get().crmOutbox.every((e) => e.sent) && ctx.state.get().crmOutbox.length > 0 ? { state: 'done' } : { state: 'absent' }),
  async run(ctx) {
    // A CRM outage must never fail a local run: the entries stay queued.
    const r = await flushOutbox(ctx.state, crmClient(ctx), ctx.request.crm?.siteId)
    if (r.crm === 'pending') ctx.log.warn(`CRM report pending: ${r.error}`)
    return r as unknown as Record<string, Json>
  },
  plan: () => [],
}

function outwardStep(id: OutwardStepId): Step {
  const a = outwardAdapter(id)
  return {
    id,
    runbook: a.runbook,
    phase: 'E',
    outward: true,
    dependsOn: ['verify'],
    fingerprint: () => fingerprintOf({ id }),
    probe: async () => ({ state: 'absent' }),
    // The runner never calls run() for outward steps; if anything does, apply() refuses.
    run: async (ctx) => a.apply(outwardInputFromCtx(ctx)),
    plan(ctx) {
      const i = outwardInputFromCtx(ctx)
      return a.plan(i).commands.map((c) => toPlannedCommand(i, c))
    },
  }
}

export const OUTWARD_STEPS: Step[] = OUTWARD_STEP_IDS.map(outwardStep)

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, content)
  renameSync(tmp, path)
}

export const outwardPlan: Step = {
  id: 'outward-plan',
  runbook: 'E',
  phase: 'E',
  outward: false,
  dependsOn: [...OUTWARD_STEP_IDS],
  fingerprint: () => fingerprintOf({ v: 1 }),
  probe: async () => ({ state: 'absent' }),
  async run(ctx) {
    const i = outwardInputFromCtx(ctx)
    const md = join(ctx.paths.record, 'outward-plan.md')
    writeAtomic(md, renderOutwardPlanMarkdown(i))
    writeAtomic(join(ctx.paths.record, 'outward-plan.json'), JSON.stringify(renderOutwardPlanJson(i), null, 2) + '\n')
    return outputs({ markdown: md })
  },
  plan: () => [],
}

/** What Claude needs for the hand-over message. Paths, never values. */
export function handoverSummary(ctx: Ctx): Record<string, Json> {
  const s = ctx.state.get()
  const r = ctx.request
  const failedChecks = s.verify.filter((v) => !v.ok).map((v) => v.check)
  const pending = s.crmOutbox.filter((e) => !e.sent).length
  return {
    slug: r.slug,
    brand: r.provisioning.brand.name,
    site: { url: `http://localhost:${s.ports.site}`, dir: ctx.paths.site },
    backend: { url: `http://localhost:${s.ports.backend}`, admin: `http://localhost:${s.ports.backend}/admin`, dir: ctx.paths.backend },
    realtorLogin: { email: r.contact.email, credentialsFile: join(ctx.paths.backend, '.admin-credentials.local'), passwordKey: 'CLIENT_PASSWORD' },
    verify: { passed: s.verify.filter((v) => v.ok).length, total: s.verify.length, failed: failedChecks },
    crm: !r.crm ? 'not linked (file input)' : pending === 0 ? 'provisioning log updated' : `pending (${pending} entries; \`cw report-crm ${r.slug}\`)`,
    todos: [
      'Replace the [NÁVRH – před spuštěním nahradit] legal texts (privacy policy, cookies) with the client\'s own.',
      'Fill every [DOPLNIT] placeholder (stats, bio) with the realtor\'s real facts.',
      'Replace the "Ukázka – …" sample listings with real ones.',
    ],
    outwardPlan: join(ctx.paths.record, 'outward-plan.md'),
    outwardSteps: Object.fromEntries(OUTWARD_STEP_IDS.map((id) => [id, s.steps[id]?.status ?? 'pending'])),
  }
}

export const handover: Step = {
  id: 'handover',
  runbook: '—',
  phase: 'E',
  outward: false,
  dependsOn: ['outward-plan', 'crm-report'],
  fingerprint: () => fingerprintOf({ v: 1 }),
  probe: async () => ({ state: 'absent' }),
  async run(ctx) {
    const summary = handoverSummary(ctx)
    // The state file and the plan carry no secrets; commit them so the record repo tells the whole story.
    // Once per provisioning: the state file changes on every run, so a resume
    // commits again only when something besides it changed (e.g. the plan).
    if (existsSync(join(ctx.paths.record, '.git')) && !(await recordUpToDate(ctx))) {
      await commitRecord(ctx, `Provisioned ${ctx.request.slug} locally; outward steps planned`, 'handover')
    }
    return summary
  },
  plan: () => [],
}
