import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MINI = path.resolve(import.meta.dirname, '../../../fixtures/mini-monorepo')
export const FIXTURES = path.resolve(import.meta.dirname, '__fixtures__')

/** A throwaway copy of the mini monorepo, optionally committed as a git repo. */
export function miniCopy(opts: { git?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw5-mini-'))
  fs.cpSync(MINI, dir, { recursive: true })
  if (opts.git) {
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' })
    g('init', '-q', '-b', 'main')
    g('add', '-A')
    g('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'mini')
  }
  return dir
}

export const novakProvisioning = () => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'novak-test.provisioning.json'), 'utf8')) as unknown

export const novakRequest = () => ({
  requestVersion: 1 as const,
  slug: 'novak-test',
  contact: { name: 'Jan Novák', email: 'jan@example.cz' },
  // the strict schema's shape is checked at runtime by the exporter
  provisioning: novakProvisioning() as never,
})
