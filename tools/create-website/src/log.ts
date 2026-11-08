/**
 * RunLogger: JSON lines in `clients/<slug>/logs/<runId>/run.log`, every
 * message redacted first. Per-step child output goes to
 * `logs/<runId>/<stepId>.log` (Exec appends there). `logs/` is git-ignored
 * in the record repo.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Redactor } from './redact.js'
import type { Json, RunLogger, StepId } from './types.js'

export class FileRunLogger implements RunLogger {
  readonly dir: string

  constructor(
    recordDir: string,
    runId: string,
    private readonly redactor: Redactor,
    private readonly echo?: (line: string) => void,
  ) {
    this.dir = join(recordDir, 'logs', runId)
  }

  private write(level: string, msg: string, data?: Record<string, Json>): void {
    const line = this.redactor.redact(JSON.stringify({ at: new Date().toISOString(), level, msg, ...(data ? { data } : {}) }))
    mkdirSync(this.dir, { recursive: true })
    appendFileSync(join(this.dir, 'run.log'), line + '\n', { mode: 0o600 })
    this.echo?.(line)
  }

  info(msg: string, data?: Record<string, Json>): void {
    this.write('info', msg, data)
  }
  warn(msg: string, data?: Record<string, Json>): void {
    this.write('warn', msg, data)
  }
  error(msg: string, data?: Record<string, Json>): void {
    this.write('error', msg, data)
  }
  stepLog(step: StepId): string {
    return join(this.dir, `${step}.log`)
  }
}

/** For commands that run before a record dir exists (validate, plan). */
export class MemoryRunLogger implements RunLogger {
  readonly dir: string
  readonly lines: Array<{ level: string; msg: string; data?: Record<string, Json> }> = []
  constructor(dir = '') {
    this.dir = dir
  }
  info(msg: string, data?: Record<string, Json>): void {
    this.lines.push({ level: 'info', msg, ...(data ? { data } : {}) })
  }
  warn(msg: string, data?: Record<string, Json>): void {
    this.lines.push({ level: 'warn', msg, ...(data ? { data } : {}) })
  }
  error(msg: string, data?: Record<string, Json>): void {
    this.lines.push({ level: 'error', msg, ...(data ? { data } : {}) })
  }
  stepLog(step: StepId): string {
    return join(this.dir || '.', `${step}.log`)
  }
}
