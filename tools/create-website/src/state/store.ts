/**
 * The state file (A3): `clients/<slug>/create-website.state.json`.
 *
 * - No secrets: it is committed in the record repo. Every write is checked
 *   against the known secret values and refused if one would leak.
 * - Writes are atomic (temp file + rename) after every change.
 * - A step found `running` on load means the process died mid-step; it
 *   becomes `failed` with code CRASHED, and probe/recover take over.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { CwError, STATE_VERSION, TOOL_VERSION, type CwState, type StateStore, type StepId, type StepState } from '../types.js'

export const STATE_FILE = 'create-website.state.json'

export function statePath(recordDir: string): string {
  return join(recordDir, STATE_FILE)
}

export type NewStateInput = Omit<CwState, 'stateVersion' | 'toolVersion' | 'createdAt' | 'updatedAt' | 'steps' | 'processes' | 'verify' | 'crmOutbox' | 'secrets' | 'templates'> &
  Partial<Pick<CwState, 'templates' | 'secrets'>>

export interface FileStateStoreOptions {
  /** values that must never appear in the state file */
  secretValues?: () => Iterable<string>
  now?: () => Date
}

export class FileStateStore implements StateStore {
  private s: CwState
  /** steps that were `running` on load and have been marked crashed */
  readonly crashedOnLoad: StepId[] = []

  private constructor(
    readonly path: string,
    state: CwState,
    private readonly o: FileStateStoreOptions,
  ) {
    this.s = state
  }

  static exists(path: string): boolean {
    return existsSync(path)
  }

  static load(path: string, o: FileStateStoreOptions = {}): FileStateStore {
    let raw: CwState
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as CwState
    } catch (e) {
      throw new CwError('PRECONDITION', `cannot read state ${path}: ${(e as Error).message}`, {
        hint: 'The state file is corrupt; restore it from the record repo (git -C clients/<slug> checkout create-website.state.json).',
      })
    }
    if (raw.stateVersion !== STATE_VERSION) {
      throw new CwError('PRECONDITION', `state ${path} has stateVersion ${String(raw.stateVersion)}; this tool reads ${STATE_VERSION}`)
    }
    const store = new FileStateStore(path, raw, o)
    const crashed = (Object.entries(raw.steps) as Array<[StepId, StepState]>).filter(([, st]) => st.status === 'running')
    if (crashed.length > 0) {
      store.update((s) => {
        for (const [id] of crashed) {
          const st = s.steps[id]!
          st.status = 'failed'
          st.error = { code: 'CRASHED', message: 'the run died while this step was running (found `running` on load)' }
          st.finishedAt = (o.now?.() ?? new Date()).toISOString()
          store.crashedOnLoad.push(id)
        }
      })
    }
    return store
  }

  static create(path: string, init: NewStateInput, o: FileStateStoreOptions = {}): FileStateStore {
    if (existsSync(path)) throw new CwError('PRECONDITION', `state already exists at ${path}`)
    const now = (o.now?.() ?? new Date()).toISOString()
    const state: CwState = {
      stateVersion: STATE_VERSION,
      toolVersion: TOOL_VERSION,
      runId: init.runId,
      slug: init.slug,
      mode: 'local',
      createdAt: now,
      updatedAt: now,
      input: init.input,
      templates: init.templates ?? {},
      paths: init.paths,
      ports: init.ports,
      ...(init.db ? { db: init.db } : {}),
      ...(init.tenantId !== undefined ? { tenantId: init.tenantId } : {}),
      ...(init.siteKey ? { siteKey: init.siteKey } : {}),
      secrets: init.secrets ?? {},
      steps: {},
      processes: { backend: null, site: null },
      verify: [],
      crmOutbox: [],
    }
    const store = new FileStateStore(path, state, o)
    store.persist()
    return store
  }

  get(): CwState {
    return this.s
  }

  update(mutator: (s: CwState) => void): CwState {
    const next = structuredClone(this.s)
    mutator(next)
    next.updatedAt = (this.o.now?.() ?? new Date()).toISOString()
    const prev = this.s
    this.s = next
    try {
      this.persist()
    } catch (e) {
      this.s = prev
      throw e
    }
    return this.s
  }

  step(id: StepId): StepState {
    return this.s.steps[id] ?? { status: 'pending', attempts: 0 }
  }

  patchStep(id: StepId, patch: Partial<StepState>): StepState {
    this.update((s) => {
      s.steps[id] = { ...(s.steps[id] ?? { status: 'pending', attempts: 0 }), ...patch }
    })
    return this.step(id)
  }

  private persist(): void {
    const text = JSON.stringify(this.s, null, 2) + '\n'
    for (const v of this.o.secretValues?.() ?? []) {
      if (v && v.length >= 8 && text.includes(v)) {
        throw new CwError('PRECONDITION', 'refusing to write a secret value into the state file (bug: a step returned a secret as an output)')
      }
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = join(dirname(this.path), `.${basename(this.path)}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`)
    writeFileSync(tmp, text, { mode: 0o644 })
    renameSync(tmp, this.path)
  }
}

/** In-memory store with the same semantics, for unit tests and `cw plan`. */
export class MemoryStateStore implements StateStore {
  readonly path = ':memory:'
  writes = 0
  constructor(private s: CwState) {}
  get(): CwState {
    return this.s
  }
  update(mutator: (s: CwState) => void): CwState {
    const next = structuredClone(this.s)
    mutator(next)
    this.s = next
    this.writes++
    return this.s
  }
  step(id: StepId): StepState {
    return this.s.steps[id] ?? { status: 'pending', attempts: 0 }
  }
  patchStep(id: StepId, patch: Partial<StepState>): StepState {
    this.update((s) => {
      s.steps[id] = { ...(s.steps[id] ?? { status: 'pending', attempts: 0 }), ...patch }
    })
    return this.step(id)
  }
}
