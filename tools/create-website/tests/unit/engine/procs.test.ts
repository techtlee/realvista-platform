import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NodeExec } from '../../../src/exec.js'
import { NodeProcessManager } from '../../../src/procs/manager.js'
import { Redactor } from '../../../src/redact.js'
import { tmp } from '../../helpers/tmp.js'

const PORT = 4431 // unit-only; outside every reserved and client range

describe('ProcessManager', () => {
  it('starts detached with PORT, finds it on the port, stops the group', async () => {
    const pm = new NodeProcessManager(new NodeExec({ redactor: new Redactor() }))
    const dir = tmp()
    const log = join(dir, 'logs/srv.log')
    const script = "require('http').createServer((q,s)=>s.end('ok')).listen(+process.env.PORT,'127.0.0.1',()=>console.log('up '+process.env.PORT))"
    const { pid } = await pm.startDetached({ name: 'backend', argv: [process.execPath, '-e', script], cwd: dir, logFile: log, port: PORT })
    try {
      let owner: number | null = null
      for (let i = 0; i < 50 && owner === null; i++) {
        await new Promise((r) => setTimeout(r, 100))
        owner = await pm.pidOnPort(PORT)
      }
      expect(owner).toBe(pid)
      expect(pm.isAlive(pid)).toBe(true)
      expect(await pm.isPortFree(PORT)).toBe(false)
      expect(readFileSync(log, 'utf8')).toContain(`up ${PORT}`)
    } finally {
      await pm.stop(pid, { timeoutMs: 3000 })
    }
    expect(pm.isAlive(pid)).toBe(false)
    expect(existsSync(log)).toBe(true)
  })

  it('refuses outward CLIs through the exec guard', async () => {
    const pm = new NodeProcessManager(new NodeExec({ redactor: new Redactor() }))
    await expect(pm.startDetached({ name: 'site', argv: ['vercel', 'dev'], cwd: tmp(), logFile: join(tmp(), 'x.log'), port: PORT })).rejects.toMatchObject({ code: 'EXEC_REFUSED' })
  })
})
