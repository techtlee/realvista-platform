/**
 * verify's secrets check: WP4's shared scanner (`runSecretsCheck`, the same
 * one `cw secrets-check` uses) plus one history check it does not do:
 * a secret FILE that was ever committed in any of the three repos.
 */
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

import { NodeExec } from '../exec.js'
import { Redactor } from '../redact.js'
import { type FileSecretStore, type SecretHit, runSecretsCheck } from '../secrets.js'
import type { Ctx, Exec } from '../types.js'

const SECRET_FILE_NAMES = new Set(['.env', '.env.local', '.admin-credentials.local', '.env.production.local'])

/** git output must not be redacted before we scan it, so the scan gets an exec with an empty Redactor. */
export function scanExec(): Pick<Exec, 'run'> {
  return new NodeExec({ redactor: new Redactor() })
}

/** Secret files ever committed, anywhere in a repo's history (names only; contents never read here). */
export async function committedSecretFiles(exec: Pick<Exec, 'run'>, repo: string): Promise<string[]> {
  if (!existsSync(join(repo, '.git'))) return []
  const r = await exec.run(['git', 'log', '--all', '--format=', '--name-only'], { cwd: repo, allowFailure: true })
  if (r.code !== 0) return []
  return [...new Set(r.stdout.split('\n').map((l) => l.trim()).filter((l) => SECRET_FILE_NAMES.has(l.split('/').pop() ?? '')))]
}

export async function verifySecrets(ctx: Ctx, exec: Pick<Exec, 'run'> = scanExec()) {
  const r = await runSecretsCheck({ exec, store: ctx.secrets as FileSecretStore, paths: ctx.paths, clientsDir: ctx.cfg.clientsDir })
  const history: SecretHit[] = []
  for (const repo of [ctx.paths.record, ctx.paths.backend, ctx.paths.site]) {
    for (const f of await committedSecretFiles(exec, repo)) {
      history.push({ file: `${relative(ctx.cfg.clientsDir, join(repo, f))} (in git history)`, key: f, kind: 'value' } as SecretHit)
    }
  }
  const hits = [...r.hits, ...history]
  return { ...r, ok: hits.length === 0, hits }
}
