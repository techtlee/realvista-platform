#!/usr/bin/env node
// Run an eval iteration: every case with_skill, plus without_skill for the cases
// whose baseline is meaningful (refusals/guards; design §C "Baselines").
//
//   node run-benchmark.mjs <workspace>/iteration-N [--cases a,b] [--parallel 4] [--model m] [--no-baseline]
//
// Then: grade the pending_llm graders (skill-creator agents/grader.md) into
// <run>/llm.json, merge with `grade.mjs <case> <run>/outputs/facts.json --llm <run>/llm.json`,
// and aggregate with skill-creator's `python -m scripts.aggregate_benchmark <iteration> --skill-name create-website`.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CASES } from './cases.mjs'
import { EVAL_TOOLS } from './lib.mjs'

const argv = process.argv.slice(2)
const iter = resolve(argv[0] ?? 'iteration-1')
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const only = opt('cases', null)?.split(',')
const parallel = Number(opt('parallel', 4))
const model = opt('model', null)
const noBaseline = argv.includes('--no-baseline')
mkdirSync(iter, { recursive: true })

const jobs = []
for (const c of CASES) {
  if (only && !only.includes(c.name)) continue
  jobs.push({ c, config: 'with_skill' })
  if (c.baseline && !noBaseline) jobs.push({ c, config: 'without_skill' })
}
// slow ones first so they overlap with the fast ones
jobs.sort((a, b) => b.c.speed.timeout_seconds - a.c.speed.timeout_seconds)

const results = []
async function worker() {
  while (jobs.length) {
    const { c, config } = jobs.shift()
    const args = [join(EVAL_TOOLS, 'run-case.mjs'), c.name, config, iter, ...(model ? ['--model', model] : [])]
    const t0 = Date.now()
    const code = await new Promise((res) => {
      const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      p.stdout.on('data', (d) => { out += d })
      p.stderr.on('data', (d) => { out += d })
      p.on('close', (code) => { writeFileSync(join(iter, `${c.name}.${config}.runner.log`), out); res(code) })
    })
    const r = { case: c.name, config, exit: code, seconds: Math.round((Date.now() - t0) / 1000) }
    results.push(r)
    console.log(JSON.stringify(r))
  }
}
await Promise.all(Array.from({ length: parallel }, worker))
writeFileSync(join(iter, 'runner-summary.json'), JSON.stringify(results, null, 2) + '\n')
