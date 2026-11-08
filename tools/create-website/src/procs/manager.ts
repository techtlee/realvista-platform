/**
 * Detached local processes (backend `next dev`, site `next start`).
 *
 * Children are spawned detached in their own process group with output going
 * straight to a log file (so they outlive the CLI); `stop` signals the whole
 * group, SIGTERM then SIGKILL. Every argv goes through the exec guard first.
 * Output written by the child itself is not redacted at write time; the
 * children only receive secrets via env, and `cw secrets-check` scans logs/.
 */
import { spawn, execFile } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

import { pidAlive } from '../lock.js'
import { isPortFree } from '../ports.js'
import type { Exec, ProcessManager, StartProcessOptions } from '../types.js'

const execFileP = promisify(execFile)

export class NodeProcessManager implements ProcessManager {
  constructor(private readonly guard: Pick<Exec, 'assertAllowed'>) {}

  async startDetached(o: StartProcessOptions): Promise<{ pid: number }> {
    this.guard.assertAllowed(o.argv)
    mkdirSync(dirname(o.logFile), { recursive: true })
    const fd = openSync(o.logFile, 'a', 0o600)
    try {
      const child = spawn(o.argv[0]!, o.argv.slice(1), {
        cwd: o.cwd,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(o.env ?? {}), PORT: String(o.port) },
        detached: true,
        stdio: ['ignore', fd, fd],
      })
      const pid = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('spawn', () => resolve(child.pid!))
      })
      child.unref()
      return { pid }
    } finally {
      closeSync(fd)
    }
  }

  isAlive(pid: number): boolean {
    return pidAlive(pid)
  }

  async stop(pid: number, opts: { timeoutMs?: number } = {}): Promise<void> {
    if (!pidAlive(pid)) return
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig) // the group: next dev spawns workers
      } catch {
        try {
          process.kill(pid, sig)
        } catch {
          /* gone */
        }
      }
    }
    signal('SIGTERM')
    const deadline = Date.now() + (opts.timeoutMs ?? 10_000)
    while (Date.now() < deadline) {
      if (!pidAlive(pid)) return
      await new Promise((r) => setTimeout(r, 100))
    }
    signal('SIGKILL')
  }

  async pidOnPort(port: number): Promise<number | null> {
    try {
      const { stdout } = await execFileP('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
      const pid = Number(stdout.trim().split('\n')[0])
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null // lsof exits 1 when nothing listens
    }
  }

  isPortFree(port: number): Promise<boolean> {
    return isPortFree(port)
  }
}
