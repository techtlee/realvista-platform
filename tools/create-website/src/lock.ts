/**
 * Per-client lock (A3): `clients/<slug>/.create-website.lock` holds
 * `{pid, runId, host, startedAt}`. A live holder gives exit 6 (LOCKED); a
 * dead one (same host, pid gone) is taken over with a log line.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'

import { CwError } from './types.js'

export const LOCK_FILE = '.create-website.lock'

export interface LockInfo {
  pid: number
  runId: string
  host: string
  startedAt: string
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface Lock {
  path: string
  info: LockInfo
  tookOver: LockInfo | null
  release(): void
}

export function acquireLock(
  recordDir: string,
  runId: string,
  o: { isAlive?: (pid: number) => boolean; pid?: number; onTakeover?: (old: LockInfo) => void } = {},
): Lock {
  const path = join(recordDir, LOCK_FILE)
  const isAlive = o.isAlive ?? pidAlive
  const info: LockInfo = { pid: o.pid ?? process.pid, runId, host: hostname(), startedAt: new Date().toISOString() }
  mkdirSync(dirname(path), { recursive: true })
  let tookOver: LockInfo | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx', 0o644)
      writeSync(fd, JSON.stringify(info) + '\n')
      closeSync(fd)
      return {
        path,
        info,
        tookOver,
        release() {
          try {
            const cur = JSON.parse(readFileSync(path, 'utf8')) as LockInfo
            if (cur.pid === info.pid && cur.startedAt === info.startedAt) rmSync(path, { force: true })
          } catch {
            /* already gone */
          }
        },
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    let held: LockInfo | null = null
    try {
      held = JSON.parse(readFileSync(path, 'utf8')) as LockInfo
    } catch {
      held = null // unreadable/half-written lock: treat as stale
    }
    const sameHost = !held || held.host === info.host
    if (held && (!sameHost || isAlive(held.pid))) {
      throw new CwError('LOCKED', `another create-website run holds ${path} (pid ${held.pid} on ${held.host}, run ${held.runId}, since ${held.startedAt})`, {
        hint: sameHost ? 'Wait for it to finish, or stop that process first.' : 'The lock is held from another machine; check there.',
      })
    }
    tookOver = held
    if (held) o.onTakeover?.(held)
    rmSync(path, { force: true })
  }
  throw new CwError('LOCKED', `could not take ${path}`)
}
