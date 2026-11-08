import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { bareVersion, parseLockImporters, pinDependencies } from '../../../src/site/lockfile.js'

const MINI = path.resolve(import.meta.dirname, '../../../fixtures/mini-monorepo')
const lock = fs.readFileSync(path.join(MINI, 'pnpm-lock.yaml'), 'utf8')

describe('parseLockImporters', () => {
  it('reads importers from the project document of a two-document pnpm 12 lockfile', () => {
    const imp = parseLockImporters(lock)
    expect(Object.keys(imp).sort()).toEqual(['.', 'apps/site', 'packages/config', 'packages/core', 'packages/theme', 'packages/unused'])
    expect(imp['apps/site']!.dependencies['@makleri/core']).toEqual({ specifier: 'workspace:*', version: 'link:../../packages/core' })
    expect(imp['apps/site']!.devDependencies.tailwindcss).toEqual({ specifier: '^4.0.0', version: '4.3.3' })
    // the project document's root importer wins over the config document's
    expect(imp['.']!.devDependencies.typescript!.version).toBe('5.8.0')
  })

  it('strips peer suffixes', () => {
    expect(bareVersion('16.4.5(@types/node@22.20.4)(react-dom@19.3.0(react@19.3.0))(react@19.3.0)')).toBe('16.4.5')
    expect(bareVersion('4.6.5')).toBe('4.6.5')
  })
})

describe('pinDependencies', () => {
  const importers = ['apps/site', 'packages/config', 'packages/core', 'packages/theme']

  it('pins exact versions, the site first, then the first package that declares it', () => {
    expect(pinDependencies(lock, importers, ['zod', 'next', 'react-dom', '@types/react-dom', 'typescript'])).toEqual({
      '@types/react-dom': '19.3.0',
      next: '16.4.5',
      'react-dom': '19.3.0',
      typescript: '5.9.3', // apps/site's, not the root's 5.8.0
      zod: '4.6.5',
    })
  })

  it('refuses a workspace link as an external', () => {
    expect(() => pinDependencies(lock, importers, ['@makleri/core'])).toThrow(/link:/)
  })

  it('names every external the lockfile does not have', () => {
    expect(() => pinDependencies(lock, importers, ['zod', 'left-pad', 'lodash'])).toThrow(/left-pad, lodash/)
  })

  it('pins the real platform lockfile like the hand-made novak-test package.json', () => {
    const real = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../../pnpm-lock.yaml'), 'utf8')
    const pins = pinDependencies(real, ['apps/site', 'packages/core', 'packages/theme-realvista'], ['react', 'react-dom', 'zod', '@types/react-dom', 'tailwindcss'])
    for (const v of Object.values(pins)) expect(v).toMatch(/^\d+\.\d+\.\d+/)
  })
})
