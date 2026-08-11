import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { pathExists } from './fs-utils.js'
import { audit, restoreConfigBackup } from './index.js'
import { CollectingReporter } from './reporter.js'
import type { OxlintConfig } from './types.js'

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-e2e-'))

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }

  return dir
}

const REACT_PROJECT = {
  'package.json': JSON.stringify({
    name: 'app',
    type: 'module',
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' },
  }),
  'src/App.tsx': 'export default () => null\n',
}

async function readConfig(configPath: string): Promise<OxlintConfig> {
  return JSON.parse(await readFile(configPath, 'utf-8')) as OxlintConfig
}

describe('audit', () => {
  it('reports without writing anything by default', async () => {
    const dir = await setupProject(REACT_PROJECT)

    const report = await audit({ projectDir: dir })

    expect(report.success).toBe(true)
    expect(report.recommendations.length).toBeGreaterThan(0)
    expect(report.config.written).toBe(false)
    expect(await pathExists(join(dir, '.oxlintrc.json'))).toBe(false)
  })

  it('recommends the plugins the detected stack justifies', async () => {
    const dir = await setupProject(REACT_PROJECT)

    const report = await audit({ projectDir: dir })
    const plugins = report.recommendations
      .filter((entry) => entry.kind === 'plugin')
      .map((entry) => entry.target)

    expect(plugins).toEqual(expect.arrayContaining(['react', 'react-perf', 'jsx-a11y', 'vitest']))
    // No Vue or Jest anywhere in this project, so neither may be recommended.
    expect(plugins).not.toContain('vue')
    expect(plugins).not.toContain('jest')
  })

  it('creates a config when asked to write', async () => {
    const dir = await setupProject(REACT_PROJECT)

    const report = await audit({ projectDir: dir, write: true })
    const config = await readConfig(join(dir, '.oxlintrc.json'))

    expect(report.config.written).toBe(true)
    expect(config.plugins).toEqual(
      expect.arrayContaining(['react', 'unicorn', 'typescript', 'oxc']),
    )
    expect(config.categories?.correctness).toBe('error')
    expect(config.rules?.['no-eval']).toBe('error')
  })

  it('is idempotent: a second run has nothing left to add', async () => {
    const dir = await setupProject(REACT_PROJECT)

    await audit({ projectDir: dir, write: true })
    const second = await audit({ projectDir: dir, write: true })

    expect(second.recommendations).toEqual([])
    expect(second.config.changed).toBe(false)
    expect(second.alreadySatisfied.length).toBeGreaterThan(0)
  })

  it('never weakens an existing config', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      '.oxlintrc.json': `${JSON.stringify(
        {
          rules: { 'no-eval': 'off', 'typescript/no-explicit-any': 'error' },
          categories: { correctness: 'error' },
          ignorePatterns: ['dist/**'],
        },
        null,
        2,
      )}\n`,
    })

    const report = await audit({ projectDir: dir, write: true })
    const config = await readConfig(join(dir, '.oxlintrc.json'))

    // Explicit off is a decision; a stricter severity outranks the recommendation.
    expect(config.rules?.['no-eval']).toBe('off')
    expect(config.rules?.['typescript/no-explicit-any']).toBe('error')
    expect(config.categories?.correctness).toBe('error')
    expect(config.ignorePatterns).toEqual(['dist/**'])
    expect(report.explicitlyDisabled.map((entry) => entry.target)).toContain('no-eval')
  })

  it('backs up an existing config before rewriting it, and can restore it', async () => {
    const original = `${JSON.stringify({ rules: { 'no-eval': 'warn' } }, null, 2)}\n`
    const dir = await setupProject({ ...REACT_PROJECT, '.oxlintrc.json': original })
    const configPath = join(dir, '.oxlintrc.json')

    await audit({ projectDir: dir, write: true })

    expect(await readFile(`${configPath}.backup`, 'utf-8')).toBe(original)

    await restoreConfigBackup(configPath, new CollectingReporter())

    expect(await readFile(configPath, 'utf-8')).toBe(original)
    expect(await pathExists(`${configPath}.backup`)).toBe(false)
  })

  it('refuses to rewrite a config with comments rather than silently dropping them', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      '.oxlintrc.json': '{\n  // keep this note\n  "rules": {}\n}\n',
    })

    const report = await audit({ projectDir: dir, write: true })

    expect(report.success).toBe(false)
    expect(report.blockers.some((blocker) => blocker.includes('contains comments'))).toBe(true)
    expect(report.config.written).toBe(false)
    expect(await readFile(join(dir, '.oxlintrc.json'), 'utf-8')).toContain('// keep this note')
  })

  it('still reports on a commented config when not writing', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      '.oxlintrc.json': '{\n  // a note\n  "rules": {}\n}\n',
    })

    const report = await audit({ projectDir: dir })

    expect(report.success).toBe(true)
    expect(report.recommendations.length).toBeGreaterThan(0)
  })

  it('fails on an unparseable config instead of overwriting it', async () => {
    const dir = await setupProject({ ...REACT_PROJECT, '.oxlintrc.json': '{ "rules": [ }\n' })

    const report = await audit({ projectDir: dir, write: true })

    expect(report.success).toBe(false)
    expect(report.errors.some((error) => error.includes('not valid JSON'))).toBe(true)
    expect(await readFile(join(dir, '.oxlintrc.json'), 'utf-8')).toBe('{ "rules": [ }\n')
  })

  it('reports a missing project directory as an error', async () => {
    const report = await audit({ projectDir: join(tmpdir(), 'oxc-audit-does-not-exist-xyz') })

    expect(report.success).toBe(false)
    expect(report.errors.some((error) => error.includes('not found'))).toBe(true)
  })

  it('refuses to run concurrently against the same project', async () => {
    const dir = await setupProject(REACT_PROJECT)
    await writeFile(
      join(dir, '.oxc-audit.lock'),
      JSON.stringify({ pid: process.ppid, startedAt: Date.now() }),
      'utf-8',
    )

    const report = await audit({ projectDir: dir, write: true })

    expect(report.success).toBe(false)
    expect(
      report.errors.some((error) => error.includes('Another oxc-audit run is in progress')),
    ).toBe(true)
  })

  it('produces a config Oxlint validation accepts', async () => {
    const dir = await setupProject(REACT_PROJECT)

    const report = await audit({ projectDir: dir, write: true })

    expect(report.blockers).toEqual([])
    expect(report.success).toBe(true)
  })
})
