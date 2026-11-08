/** `cw copy init|validate <slug>`: the CLI's entry point into starter copy. */
import type { Config, Ctx, Json, ProvisioningRequest } from '../types.js'
import { CwError } from '../types.js'
import { initStarterCopy, validateStarterCopy } from './index.js'

export async function runCopyCommand(o: {
  sub: 'init' | 'validate'
  slug: string
  cfg: Config
  paths: Ctx['paths']
  request: ProvisioningRequest
}): Promise<Record<string, Json>> {
  const args = { recordDir: o.paths.record, backendDir: o.paths.backend, request: o.request }
  if (o.sub === 'init') {
    const r = await initStarterCopy(args)
    return { path: r.path, created: r.created }
  }
  const v = await validateStarterCopy(args)
  if (!v.ok) {
    throw new CwError('INVALID_STARTER_COPY', `starter-copy.json has ${v.issues.length} issue(s)`, {
      hint: 'Fix each path (references/czech-copy.md), then `cw copy validate` and `cw run <slug>`.',
      details: v.issues.map((i) => ({ path: i.path, message: i.message })),
    })
  }
  return { path: v.path, valid: true }
}
