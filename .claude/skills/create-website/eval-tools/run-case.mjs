#!/usr/bin/env node
// Run ONE /create-website eval case in one configuration, skill-creator layout.
//
//   node run-case.mjs <case> <with_skill|without_skill> <iterationDir> [--model m] [--keep] [--run-number n]
//
// Layout written (skill-creator "Running and evaluating test cases"):
//   <iterationDir>/<case>/eval_metadata.json
//   <iterationDir>/<case>/<config>/outputs/{transcript.jsonl,transcript.txt,final.md,facts.json,state-*.json,outward-plan.md}
//   <iterationDir>/<case>/<config>/{timing.json,grading.json}
//
// The run gets its own temp cwd ($TMPDIR/cw-eval-…) holding create-website.config.json
// (ports/DB prefix per case+slot, see lib.portsFor), so nothing outside it is touched.
// with_skill symlinks the skill into <cwd>/.claude/skills/create-website; without_skill
// gets no skill and the leading "/create-website" of the prompt is turned into words.
// PATH is prefixed with the case's shims (gh/vercel/neonctl/doctl log + exit 1).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync, createWriteStream, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { caseByName } from './cases.mjs'
import { EVAL_TOOLS, PLATFORM_DEFAULT, SKILL_DIR, parseTranscript, renderTranscript, sh } from './lib.mjs'
import { teardownRun } from './teardown.mjs'

const [caseName, config, iterArg] = process.argv.slice(2)
const flag = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const keep = process.argv.includes('--keep')
const model = flag('model', process.env.CW_EVAL_MODEL ?? 'claude-opus-5-5')
const runNumber = flag('run-number', null)
if (!caseName || !['with_skill', 'without_skill'].includes(config) || !iterArg) {
  console.error('usage: run-case.mjs <case> <with_skill|without_skill> <iterationDir> [--model m] [--keep]')
  process.exit(2)
}
const c = caseByName(caseName)
const caseDir = join(SKILL_DIR, 'evals', c.name)
const iterDir = resolve(iterArg)
const caseOut = join(iterDir, c.name)
const runDir = runNumber ? join(caseOut, config, `run-${runNumber}`) : join(caseOut, config)
const outputs = join(runDir, 'outputs')
mkdirSync(outputs, { recursive: true })

const promptMd = readFileSync(join(caseDir, 'prompt.md'), 'utf8')
const promptBody = promptMd.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
writeFileSync(join(caseOut, 'eval_metadata.json'), JSON.stringify({ eval_name: c.name, prompt: promptBody, assertions: c.graders.map((g) => g.text) }, null, 2) + '\n')

let prompt = promptBody
if (config === 'without_skill') prompt = prompt.replace(/^\/create-website\s+/, 'Create the REALVISTA client website from ')

// --- scaffold ---------------------------------------------------------------
const platform = resolve(process.env.CW_EVAL_PLATFORM ?? PLATFORM_DEFAULT)
const runCwd = mkdtempSync(join(tmpdir(), `cw-eval-${c.no}-${config === 'with_skill' ? 'w' : 'b'}-`))
const slot = config === 'with_skill' ? 0 : 1
const env = { ...process.env, CW_EVAL_SLOT: String(slot), CW_EVAL_PLATFORM: platform }
delete env.CW_TEST_HOOKS; delete env.CW_FAIL_AT; delete env.CW_CRASH_AT
const t0 = Date.now()
const sc = sh('bash', [join(caseDir, 'place-files.sh')], { cwd: runCwd, env, timeoutMs: 2_400_000 })
writeFileSync(join(outputs, 'scaffold.log'), sc.stdout + sc.stderr)
if (sc.code !== 0) {
  console.error(`scaffold failed for ${c.name}: ${sc.stderr.slice(-1500)}`)
  writeFileSync(join(runDir, 'grading.json'), JSON.stringify({ expectations: c.graders.map((g) => ({ text: g.text, passed: false, evidence: `scaffold failed: ${sc.stderr.slice(-300)}` })), summary: { passed: 0, failed: c.graders.length, total: c.graders.length, pass_rate: 0 } }, null, 2))
  teardownRun(runCwd, { keep })
  process.exit(1)
}
const scaffoldSeconds = (Date.now() - t0) / 1000
if (config === 'with_skill') {
  mkdirSync(join(runCwd, '.claude', 'skills'), { recursive: true })
  symlinkSync(SKILL_DIR, join(runCwd, '.claude', 'skills', 'create-website'))
}

// --- run Claude -------------------------------------------------------------
const maxTurns = Number(promptMd.match(/max_turns:\s*(\d+)/)?.[1] ?? 25)
const timeoutS = Number(promptMd.match(/timeout_seconds:\s*(\d+)/)?.[1] ?? 600)
const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', model,
  '--max-turns', String(maxTurns), '--allowedTools', 'Read', 'Glob', 'Grep', 'Skill', 'Write', 'Edit', 'Bash',
  '--permission-mode', 'acceptEdits', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence']
const runEnv = { ...env, PATH: `${join(runCwd, 'bin')}:${process.env.PATH}`, CW_EVAL_OUTWARD_LOG: join(runCwd, 'outward-calls.log') }
delete runEnv.CW_EVAL_SLOT
const transcriptPath = join(outputs, 'transcript.jsonl')
const started = new Date()
const code = await new Promise((res) => {
  const out = createWriteStream(transcriptPath)
  const p = spawn('claude', args, { cwd: runCwd, env: runEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  p.stdout.pipe(out)
  let err = ''
  p.stderr.on('data', (d) => { err += d })
  const timer = setTimeout(() => { p.kill('SIGTERM'); err += `\n[run-case] killed after ${timeoutS}s` }, timeoutS * 1000)
  p.on('close', (code) => { clearTimeout(timer); writeFileSync(join(outputs, 'claude.stderr.log'), err); out.end(); res(code) })
})
const ended = new Date()

// --- timing -----------------------------------------------------------------
const raw = readFileSync(transcriptPath, 'utf8')
const resultEv = raw.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((e) => e?.type === 'result').pop()
const u = resultEv?.usage ?? {}
const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
const durMs = resultEv?.duration_ms ?? ended - started
writeFileSync(join(runDir, 'timing.json'), JSON.stringify({
  total_tokens: tokens || null, duration_ms: durMs, total_duration_seconds: Number((durMs / 1000).toFixed(1)),
  executor_start: started.toISOString(), executor_end: ended.toISOString(), executor_duration_seconds: Number(((ended - started) / 1000).toFixed(1)),
  scaffold_seconds: scaffoldSeconds, num_turns: resultEv?.num_turns ?? null, exit_code: code, cost_usd: resultEv?.total_cost_usd ?? null,
}, null, 2) + '\n')

// --- outputs + facts + grading ----------------------------------------------
const t = parseTranscript(raw)
writeFileSync(join(outputs, 'transcript.txt'), renderTranscript(t))
writeFileSync(join(outputs, 'final.md'), t.final + '\n')
const metrics = { tool_calls: {}, total_tool_calls: t.tools.length, total_steps: resultEv?.num_turns ?? null, errors_encountered: code === 0 ? 0 : 1, output_chars: t.final.length, transcript_chars: raw.length }
for (const x of t.tools) metrics.tool_calls[x.name] = (metrics.tool_calls[x.name] ?? 0) + 1
writeFileSync(join(outputs, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n')

const collect = sh(process.execPath, [join(EVAL_TOOLS, 'collect.mjs'), runCwd, '--transcript', transcriptPath, '--outputs', outputs], { cwd: runCwd, env, timeoutMs: 600_000, maxBuffer: 64 * 1024 * 1024 })
writeFileSync(join(outputs, 'facts.json'), collect.stdout || JSON.stringify({ collectError: collect.stderr }))
// keep the state and plan for the viewer (no secrets in either)
const clients = join(runCwd, 'clients')
if (existsSync(clients)) for (const d of readdirSync(clients)) {
  for (const f of ['create-website.state.json', 'outward-plan.md', 'starter-copy.json']) {
    const p = join(clients, d, f)
    if (existsSync(p)) copyFileSync(p, join(outputs, `${d}.${f}`))
  }
}
const grade = sh(process.execPath, [join(EVAL_TOOLS, 'grade.mjs'), c.name, join(outputs, 'facts.json')], { timeoutMs: 60_000 })
writeFileSync(join(runDir, 'grading.json'), grade.stdout || JSON.stringify({ gradeError: grade.stderr }))

teardownRun(runCwd, { keep })
console.log(JSON.stringify({ case: c.name, config, exit: code, runDir, runCwd: keep ? runCwd : '(removed)', seconds: (ended - started) / 1000 }))
