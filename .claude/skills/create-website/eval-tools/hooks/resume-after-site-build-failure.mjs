// Case 4 scaffold: a REAL svoboda-reality run that dies at site-build (before),
// then both local processes are stopped ("it died yesterday"). Records what must
// not change on resume.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnvFile, sh, sha256 } from '../lib.mjs'

export default async function ({ run, platform }) {
  const cw = join(platform, 'tools', 'create-website', 'bin', 'cw')
  const env = { ...process.env, CW_TEST_HOOKS: '1', CW_FAIL_AT: 'site-build:before' }
  const r = sh(cw, ['run', '--request', 'files/svoboda.request.json', '--json'], { cwd: run, env, timeoutMs: 1_800_000 })
  if (r.code !== 5) {
    throw new Error(`hook: expected cw run to exit 5 at site-build:before, got ${r.code}\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`)
  }
  sh(cw, ['stop', 'svoboda-reality', '--json'], { cwd: run, timeoutMs: 60_000 })
  const clients = join(run, 'clients')
  const state = JSON.parse(readFileSync(join(clients, 'svoboda-reality', 'create-website.state.json'), 'utf8'))
  const credsPath = join(clients, 'backend-svoboda-reality', '.admin-credentials.local')
  const envPath = join(clients, 'backend-svoboda-reality', '.env')
  return {
    hookExit: r.code,
    runId: state.runId,
    failedStep: Object.entries(state.steps).find(([, s]) => s.status === 'failed')?.[0] ?? null,
    credsSha256: existsSync(credsPath) ? sha256(readFileSync(credsPath)) : null,
    payloadSecretHash: sha256(parseEnvFile(envPath).PAYLOAD_SECRET ?? ''),
    siteKeyMintedAt: state.siteKey?.mintedAt ?? null,
    ports: state.ports,
  }
}
