#!/usr/bin/env node
// Writes evals/<case>/ (skill-creator / `claude plugin eval` layout) from cases.mjs
// and the request fixtures in tools/create-website/fixtures/requests/.
//
//   node .claude/skills/create-website/eval-tools/build-cases.mjs
//
// Regenerate instead of editing evals/* by hand.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CASES, FAKE_CRM_FIXTURES } from './cases.mjs'
import { EVAL_TOOLS, PLATFORM_DEFAULT, SKILL_DIR, portsFor } from './lib.mjs'

const FIXTURES = join(PLATFORM_DEFAULT, 'tools', 'create-website', 'fixtures', 'requests')
const EVALS = join(SKILL_DIR, 'evals')
const RESERVED = [3000, 3001, 3003, 3004, 3017, 3027, 3029]

const SHIM = `#!/usr/bin/env bash
# PATH shim for /create-website evals: outward CLIs must never run here.
# Logs the call and fails. The runner prepends files/bin (copied to ./bin) to PATH.
LOG="\${CW_EVAL_OUTWARD_LOG:-$(cd "$(dirname "$0")/.." && pwd)/outward-calls.log}"
printf '%s\\t%s\\t%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$0")" "$*" >> "$LOG"
echo "$(basename "$0"): blocked in the /create-website eval sandbox (outward calls are not allowed)" >&2
exit 1
`

function fakeCrmData(c) {
  const leads = {}
  for (const [id, l] of Object.entries(FAKE_CRM_FIXTURES.leads)) {
    leads[id] = l.fixture
      ? { status: l.status, body: JSON.parse(readFileSync(join(FIXTURES, l.fixture), 'utf8')) }
      : { status: l.status, body: l.body }
  }
  return { apiKey: `fake-crm-key-${String(c.no).padStart(2, '0')}`, users: [{ email: 'provisioner@realvista.test', password: 'fake-crm-password' }], leads, sites: FAKE_CRM_FIXTURES.sites }
}

// Template: scaffold.mjs fills ${CW_EVAL_*} and, for slot 1 (baseline), shifts ports/dbPrefix/CRM port.
// No comment key inside: the engine's config schema may be strict.
function configTemplate(c) {
  const p = portsFor(c.no, 0)
  return {
    clientsDir: './clients',
    platformRepo: '${CW_EVAL_PLATFORM}',
    cmsRepo: '${CW_EVAL_CMS}',
    cmsRef: '${CW_EVAL_CMS_REF}',
    postgres: { host: 'localhost', port: 5432 },
    dbPrefix: `cweval_${String(c.no).padStart(2, '0')}_0_`,
    ports: { site: p.site, backend: p.backend, reserved: RESERVED },
    crm: { url: `http://127.0.0.1:${p.crm}`, apiKeyFile: './.fake-crm/api-key' },
    subdomainBase: 'realvista.cz',
    testMode: true,
  }
}

for (const c of CASES) {
  const dir = join(EVALS, c.name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'graders'), { recursive: true })
  mkdirSync(join(dir, 'files', 'bin'), { recursive: true })

  const fileNames = Object.keys(c.files)
  const settings = [
    '---',
    `tags: [${c.speed.tags.join(', ')}]`,
    `max_turns: ${c.speed.max_turns}`,
    `timeout_seconds: ${c.speed.timeout_seconds}`,
    'allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]',
    '---',
    '',
  ].join('\n')
  const inputLine = fileNames.length ? `\n\nInput files: ${fileNames.map((f) => `files/${f}`).join(', ')}` : ''
  writeFileSync(join(dir, 'prompt.md'), `${settings}\n${c.prompt}${inputLine}\n`)

  const expected = c.expected.trim().split('\n').map((l) => `  ${l.trim()}`).join('\n')
  writeFileSync(join(dir, 'case.yaml'), `schema_version: "1.1"\nname: ${c.name}\nexpected_outcome: |\n${expected}\ncontext:\n  scaffold_script: place-files.sh\n`)

  for (const g of c.graders) {
    writeFileSync(join(dir, 'graders', `${g.id}.md`), `---\ntype: llm\nfocus: trace\nweight: 1\n---\n\n${g.text}\n`)
  }

  for (const [to, from] of Object.entries(c.files)) copyFileSync(join(FIXTURES, from), join(dir, 'files', to))
  writeFileSync(join(dir, 'files', 'create-website.config.json'), JSON.stringify(configTemplate(c), null, 2) + '\n')
  writeFileSync(join(dir, 'files', 'fake-crm.json'), JSON.stringify(fakeCrmData(c), null, 2) + '\n')
  for (const b of ['gh', 'vercel', 'neonctl', 'doctl']) {
    writeFileSync(join(dir, 'files', 'bin', b), SHIM)
    chmodSync(join(dir, 'files', 'bin', b), 0o755)
  }

  writeFileSync(join(dir, 'place-files.sh'), `#!/usr/bin/env bash
# Scaffold for ${c.name}: places files/ into the run cwd, writes create-website.config.json,
# starts the fake CRM${c.hook ? `, then runs eval-tools/hooks/${c.hook}` : ''}. See eval-tools/scaffold.mjs.
set -eu
CASE_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$CASE_DIR/../../eval-tools/scaffold.mjs" "$CASE_DIR"
`)
  chmodSync(join(dir, 'place-files.sh'), 0o755)
}

console.log(`wrote ${CASES.length} cases under ${EVALS}`)
void EVAL_TOOLS
