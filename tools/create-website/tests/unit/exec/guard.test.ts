import { describe, expect, it } from 'vitest'

import { NodeExec, assertAllowedArgv } from '../../../src/exec.js'
import { Redactor } from '../../../src/redact.js'
import { CwError, OUTWARD_ENABLED, OutwardDisabledError } from '../../../src/types.js'
import { tmp } from '../../helpers/tmp.js'

const refused = (argv: string[], secrets: string[] = []) => {
  try {
    assertAllowedArgv(argv, secrets)
  } catch (e) {
    expect(e).toBeInstanceOf(CwError)
    expect((e as CwError).code).toBe('EXEC_REFUSED')
    expect((e as CwError).exitCode).toBe(7)
    return true
  }
  return false
}

describe('exec guard', () => {
  it.each([
    [['gh', 'repo', 'create', 'x']],
    [['/opt/homebrew/bin/gh', 'auth', 'status']],
    [['vercel', 'link']],
    [['neonctl', 'projects', 'list']],
    [['doctl', 'compute', 'domain', 'list']],
    [['npx', 'vercel', 'env', 'add']],
    [['npx', '-y', 'vercel@latest', 'deploy']],
    [['pnpm', 'dlx', 'vercel', 'link']],
    [['pnpm', 'exec', 'gh', 'repo', 'list']],
    [['bash', '-c', 'cd x && vercel deploy --prod']],
    [['sh', '-c', 'gh repo create foo']],
    [['curl', 'https://api.vercel.com/v9/projects']],
    [['curl', '-H', 'x', 'https://API.GITHUB.COM/user/repos']],
    [['wget', 'https://api.github.com/repos']],
    [['node', 'script.mjs', '--set-nameservers']],
    [['dig', 'ns1.vercel-dns.com']],
    [['echo', 'change the nameserver at Wedos']],
  ])('refuses %j', (argv) => {
    expect(refused(argv)).toBe(true)
  })

  it.each([
    [['git', 'commit', '-m', 'Copy of the REALVISTA site template']],
    [['pnpm', 'install', '--frozen-lockfile']],
    [['pnpm', 'exec', 'next', 'dev', '--port', '3211']],
    [['git', 'archive', 'abc123']],
    [['node', '-e', '1']],
    [['dig', 'dns.example.cz']],
    [['git', 'add', 'clients/site-ghost-reality']],
  ])('allows %j', (argv) => {
    expect(refused(argv)).toBe(false)
  })

  it('refuses argv containing a secret value, without echoing it', () => {
    const secret = 'Zx9-very-secret-value'
    try {
      assertAllowedArgv(['node', 'x.mjs', `--key=${secret}`], [secret])
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toMatch(/secret value/)
      expect((e as Error).message).not.toContain(secret)
    }
  })

  it('refuses before spawning anything', async () => {
    const exec = new NodeExec({ redactor: new Redactor() })
    await expect(exec.run(['gh', '--version'], { cwd: tmp() })).rejects.toMatchObject({ code: 'EXEC_REFUSED' })
  })

  it('the outward kill switch is a compile-time false', () => {
    expect(OUTWARD_ENABLED).toBe(false)
    const apply = () => {
      if (!OUTWARD_ENABLED) throw new OutwardDisabledError('github-repos')
    }
    expect(apply).toThrow(OutwardDisabledError)
  })
})

describe('NodeExec', () => {
  it('passes env, returns redacted output, throws STEP_FAILED with the tail on non-zero', async () => {
    const r = new Redactor()
    const exec = new NodeExec({ redactor: r })
    const cwd = tmp()
    const ok = await exec.run(['node', '-e', 'process.stdout.write(process.env.CMS_API_KEY)'], { cwd, env: { CMS_API_KEY: 'site-key-0123456789' } })
    expect(ok.stdout).toBe('[REDACTED]')
    await expect(exec.run(['node', '-e', 'console.error("boom"); process.exit(3)'], { cwd })).rejects.toMatchObject({
      code: 'STEP_FAILED',
      message: expect.stringContaining('boom'),
    })
    const soft = await exec.run(['node', '-e', 'process.exit(4)'], { cwd, allowFailure: true })
    expect(soft.code).toBe(4)
  })

  it('does not leak our own environment into children', async () => {
    process.env.CW_UNIT_LEAK = 'leaky'
    const exec = new NodeExec({ redactor: new Redactor() })
    const res = await exec.run(['node', '-e', 'process.stdout.write(String(process.env.CW_UNIT_LEAK))'], { cwd: tmp() })
    delete process.env.CW_UNIT_LEAK
    expect(res.stdout).toBe('undefined')
  })
})
