import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { acquireLock } from '../../../src/lock.js'
import { FileStateStore, statePath } from '../../../src/state/store.js'
import { RUN_ID_RE, newRunId } from '../../../src/state/runId.js'
import { fingerprint, sha256Json } from '../../../src/state/hash.js'
import { baseState } from '../../helpers/fakeWorld.js'
import { tmp } from '../../helpers/tmp.js'

function init(dir: string) {
  const s = baseState({ paths: { record: dir, backend: `${dir}-b`, site: `${dir}-s` } })
  return FileStateStore.create(statePath(dir), {
    runId: s.runId,
    slug: s.slug,
    mode: 'local',
    input: s.input,
    paths: s.paths,
    ports: s.ports,
  })
}

describe('FileStateStore', () => {
  it('writes atomically: valid JSON after every update, no temp files left', () => {
    const dir = tmp()
    const st = init(dir)
    for (let i = 0; i < 20; i++) st.patchStep('backend-copy', { status: 'running', attempts: i })
    expect(JSON.parse(readFileSync(st.path, 'utf8')).steps['backend-copy'].attempts).toBe(19)
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('round-trips and keeps runId', () => {
    const dir = tmp()
    const st = init(dir)
    st.patchStep('input', { status: 'done', attempts: 1, fingerprint: 'sha256:x' })
    const again = FileStateStore.load(st.path)
    expect(again.get().runId).toBe(st.get().runId)
    expect(again.step('input')).toMatchObject({ status: 'done', fingerprint: 'sha256:x' })
    expect(again.step('verify')).toEqual({ status: 'pending', attempts: 0 })
  })

  it('a step found `running` on load becomes failed (CRASHED)', () => {
    const dir = tmp()
    const st = init(dir)
    st.patchStep('backend-copy', { status: 'running', attempts: 1 })
    const again = FileStateStore.load(st.path)
    expect(again.crashedOnLoad).toEqual(['backend-copy'])
    expect(again.step('backend-copy')).toMatchObject({ status: 'failed', error: { code: 'CRASHED' } })
    expect(JSON.parse(readFileSync(st.path, 'utf8')).steps['backend-copy'].status).toBe('failed')
  })

  it('refuses to write a known secret value and keeps the previous state', () => {
    const dir = tmp()
    const secret = 'payload-secret-value-1'
    const s = init(dir)
    const st = FileStateStore.load(s.path, { secretValues: () => [secret] })
    expect(() => st.patchStep('backend-env', { status: 'done', attempts: 1, outputs: { oops: secret } })).toThrow(/secret/)
    expect(readFileSync(st.path, 'utf8')).not.toContain(secret)
    expect(st.step('backend-env').status).toBe('pending')
  })

  it('refuses a foreign stateVersion and a corrupt file', () => {
    const dir = tmp()
    const p = statePath(dir)
    writeFileSync(p, JSON.stringify({ stateVersion: 2 }))
    expect(() => FileStateStore.load(p)).toThrow(/stateVersion 2/)
    writeFileSync(p, '{nope')
    expect(() => FileStateStore.load(p)).toThrow(/cannot read state/)
  })

  it('create refuses to overwrite an existing state', () => {
    const dir = tmp()
    init(dir)
    expect(() => init(dir)).toThrow(/already exists/)
  })
})

describe('runId and hashing', () => {
  it('runIds are sortable and well-formed', () => {
    expect(newRunId(new Date('2026-11-08T12:03:01.123Z'))).toMatch(/^cw-20261108T120301Z-[0-9a-f]{4}$/)
    expect(newRunId()).toMatch(RUN_ID_RE)
  })
  it('hashes ignore key order', () => {
    expect(sha256Json({ a: 1, b: { c: 2, d: 3 } })).toBe(sha256Json({ b: { d: 3, c: 2 }, a: 1 }))
    expect(fingerprint('x', { a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(fingerprint('x', { a: 1 })).not.toBe(fingerprint('x', { a: 2 }))
  })
})

describe('lock', () => {
  it('a live holder gives LOCKED (exit 6)', () => {
    const dir = tmp()
    const a = acquireLock(dir, 'cw-a', { pid: 111, isAlive: () => true })
    expect(() => acquireLock(dir, 'cw-b', { pid: 222, isAlive: () => true })).toThrow(expect.objectContaining({ code: 'LOCKED', exitCode: 6 }))
    a.release()
    expect(existsSync(join(dir, '.create-website.lock'))).toBe(false)
  })

  it('a dead holder is taken over with a callback', () => {
    const dir = tmp()
    acquireLock(dir, 'cw-a', { pid: 111, isAlive: () => true })
    const seen: number[] = []
    const b = acquireLock(dir, 'cw-b', { pid: 222, isAlive: (pid) => pid !== 111, onTakeover: (o) => seen.push(o.pid) })
    expect(seen).toEqual([111])
    expect(b.tookOver?.runId).toBe('cw-a')
    expect(JSON.parse(readFileSync(b.path, 'utf8')).runId).toBe('cw-b')
  })

  it('release only removes our own lock', () => {
    const dir = tmp()
    const a = acquireLock(dir, 'cw-a', { pid: 111, isAlive: () => false })
    acquireLock(dir, 'cw-b', { pid: 222, isAlive: () => false })
    a.release()
    expect(JSON.parse(readFileSync(join(dir, '.create-website.lock'), 'utf8')).runId).toBe('cw-b')
  })

  it('uses the real pid check by default', () => {
    const dir = tmp()
    acquireLock(dir, 'cw-a')
    expect(() => acquireLock(dir, 'cw-b')).toThrow(/another create-website run/)
  })
})
