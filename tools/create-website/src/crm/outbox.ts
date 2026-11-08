/**
 * The CRM outbox (state.crmOutbox): every reportable event is queued in the
 * state file first, then flushed. Keys are `<runId>:<crmLogName>:<status>`,
 * so a resume or a retry never logs the same thing twice (the server dedupes
 * on the key as well).
 *
 * An outage never fails a run: entries stay `sent:false` and `cw report-crm`
 * (or the next run) delivers them.
 */
import type { CrmOutboxEntry, StateStore } from '../types.js'
import type { CrmClient } from './client.js'

export function outboxKey(runId: string, step: string, status: CrmOutboxEntry['status']): string {
  return `${runId}:${step}:${status}`
}

/** Queues an entry unless its key is already queued. Returns the entry if new. */
export function enqueue(
  state: StateStore,
  e: { step: string; status: CrmOutboxEntry['status']; detail: string; at?: string },
): CrmOutboxEntry | null {
  const s = state.get()
  const key = outboxKey(s.runId, e.step, e.status)
  if (s.crmOutbox.some((x) => x.key === key)) return null
  const entry: CrmOutboxEntry = { key, step: e.step, status: e.status, at: e.at ?? new Date().toISOString(), detail: e.detail.slice(0, 4000), sent: false }
  state.update((st) => {
    st.crmOutbox.push(entry)
  })
  return entry
}

export type FlushResult =
  | { crm: 'none'; reason: string; pending: number }
  | { crm: 'ok'; sent: number; alreadyThere: number; pending: 0 }
  | { crm: 'pending'; sent: number; pending: number; error: string }

/**
 * Sends unsent entries in order. Stops at the first failure (order matters
 * for a human reading the log) and keeps the rest for later. Never throws.
 */
export async function flushOutbox(state: StateStore, client: CrmClient | null, siteId: number | undefined): Promise<FlushResult> {
  const pendingCount = () => state.get().crmOutbox.filter((e) => !e.sent).length
  if (!client) return { crm: 'none', reason: 'no crm configured', pending: pendingCount() }
  if (siteId === undefined) return { crm: 'none', reason: 'request has no CRM site id (file input without a lead)', pending: pendingCount() }
  const runId = state.get().runId
  let sent = 0
  let alreadyThere = 0
  for (const e of state.get().crmOutbox.filter((x) => !x.sent)) {
    try {
      const r = await client.appendLog(siteId, e, runId)
      if (r.appended) sent++
      else alreadyThere++
      state.update((s) => {
        const x = s.crmOutbox.find((y) => y.key === e.key)!
        x.sent = true
        x.sentAt = new Date().toISOString()
        delete x.lastError
      })
    } catch (err) {
      const msg = (err as Error).message
      state.update((s) => {
        const x = s.crmOutbox.find((y) => y.key === e.key)!
        x.lastError = msg.slice(0, 500)
      })
      return { crm: 'pending', sent, pending: pendingCount(), error: msg }
    }
  }
  return { crm: 'ok', sent, alreadyThere, pending: 0 }
}
