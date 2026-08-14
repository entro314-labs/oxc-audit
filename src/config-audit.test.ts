import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { auditConfigFiles, compareVersions, minimumVersionOf } from './config-audit.js'
import { CollectingReporter } from './reporter.js'
import type { ConfigFinding } from './types.js'

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-config-'))

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }

  return dir
}

function keys(findings: ConfigFinding[]): string[] {
  return findings.map((finding) => `${finding.file}:${finding.key}`)
}

describe('minimumVersionOf', () => {
  it('reduces the range forms a manifest actually contains', () => {
    expect(minimumVersionOf('^16.2.0')).toBe('16.2.0')
    expect(minimumVersionOf('~7.0.40')).toBe('7.0.40')
    expect(minimumVersionOf('>=22.0.0')).toBe('22.0.0')
    expect(minimumVersionOf('5.0.11')).toBe('5.0.11')
  })

  it('returns null rather than guessing at a range it cannot reduce', () => {
    expect(minimumVersionOf('*')).toBeNull()
    expect(minimumVersionOf('workspace:*')).toBeNull()
    expect(minimumVersionOf('npm:next@latest')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders by each segment in turn', () => {
    expect(compareVersions('16.2.10', '16.2.11')).toBeLessThan(0)
    expect(compareVersions('16.3.0', '16.2.11')).toBeGreaterThan(0)
    expect(compareVersions('7.0.42', '7.0.42')).toBe(0)
  })
})

describe('auditConfigFiles', () => {
  it('reports nothing for a project with no configuration files', async () => {
    const dir = await setupProject({ 'README.md': '# app' })

    expect(await auditConfigFiles(dir, new CollectingReporter())).toEqual([])
  })

  it('flags the Turborepo 1.x pipeline key', async () => {
    const dir = await setupProject({
      'turbo.json': JSON.stringify({ pipeline: { build: { outputs: ['dist/**'] } } }),
    })

    const findings = await auditConfigFiles(dir, new CollectingReporter())

    expect(keys(findings)).toContain('turbo.json:pipeline')
  })

  it('flags a build task that declares no outputs', async () => {
    const dir = await setupProject({
      'turbo.json': JSON.stringify({
        tasks: { build: { dependsOn: ['^build'] }, lint: {}, test: { cache: false } },
      }),
    })

    const findings = await auditConfigFiles(dir, new CollectingReporter())

    // `lint` has no outputs either, but a lint task legitimately produces none.
    expect(keys(findings)).toEqual([
      'turbo.json:tasks.build.outputs',
      'turbo.json:tasks.test.cache',
    ])
  })

  it('flags pnpm settings consolidated in pnpm 11', async () => {
    const dir = await setupProject({
      'pnpm-workspace.yaml': [
        'packages:',
        '  - packages/*',
        'onlyBuiltDependencies:',
        '  - esbuild',
        'minimumReleaseAge: 0',
        'blockExoticSubdeps: false',
        'auditConfig:',
        '  ignoreCves:',
        '    - CVE-2025-0001',
      ].join('\n'),
    })

    const findings = await auditConfigFiles(dir, new CollectingReporter())

    expect(keys(findings)).toEqual([
      'pnpm-workspace.yaml:onlyBuiltDependencies',
      'pnpm-workspace.yaml:auditConfig.ignoreCves',
      'pnpm-workspace.yaml:minimumReleaseAge',
      'pnpm-workspace.yaml:blockExoticSubdeps',
    ])
  })

  it('leaves a current pnpm-workspace.yaml alone', async () => {
    const dir = await setupProject({
      'pnpm-workspace.yaml': ['allowBuilds:', '  esbuild: true', 'minimumReleaseAge: 1440'].join(
        '\n',
      ),
    })

    expect(await auditConfigFiles(dir, new CollectingReporter())).toEqual([])
  })

  it('flags dependencies below a published security floor', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { next: '^16.2.9', ai: '^7.0.50', zustand: '^5.0.9' },
      }),
    })

    const findings = await auditConfigFiles(dir, new CollectingReporter())

    // `ai` is above its floor, so only the two below theirs are reported.
    expect(keys(findings)).toEqual([
      'package.json:dependencies.next',
      'package.json:dependencies.zustand',
    ])
    expect(findings[0]?.severity).toBe('error')
  })

  it('reports an unreducible range instead of silently passing it', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { next: 'canary' } }),
    })

    const findings = await auditConfigFiles(dir, new CollectingReporter())

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('info')
  })

  it('flags a Node engine below what an installed dependency requires', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { ai: '^7.0.62' },
        engines: { node: '>=20.0.0' },
      }),
    })

    const findings = await auditConfigFiles(dir, new CollectingReporter())

    expect(keys(findings)).toEqual(['package.json:engines.node'])
  })

  it('flags the tsconfig options Next.js 16.3 stopped suppressing', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { next: '^16.3.0' } }),
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', moduleResolution: 'node', strict: true },
      }),
    })

    const findings = await auditConfigFiles(dir, new CollectingReporter())

    expect(keys(findings)).toEqual([
      'tsconfig.json:compilerOptions.baseUrl',
      'tsconfig.json:compilerOptions.moduleResolution',
    ])
  })

  it('leaves those options alone outside a Next.js project', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: {} }),
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', moduleResolution: 'node', strict: true },
      }),
    })

    expect(await auditConfigFiles(dir, new CollectingReporter())).toEqual([])
  })

  it('parses a tsconfig containing comments rather than skipping its checks', async () => {
    const dir = await setupProject({
      'tsconfig.json': [
        '{',
        '  // the default template ships with comments',
        '  "compilerOptions": {',
        '    "strict": false,',
        '  },',
        '}',
      ].join('\n'),
    })

    const reporter = new CollectingReporter()
    const findings = await auditConfigFiles(dir, reporter)

    expect(keys(findings)).toEqual(['tsconfig.json:compilerOptions.strict'])
    expect(reporter.getWarnings()).toEqual([])
  })

  it('skips a malformed file with a warning instead of aborting the audit', async () => {
    const dir = await setupProject({
      'turbo.json': '{ this is not json',
      'package.json': JSON.stringify({ name: 'app', dependencies: { next: '^16.2.0' } }),
    })

    const reporter = new CollectingReporter()
    const findings = await auditConfigFiles(dir, reporter)

    expect(reporter.getWarnings()).toHaveLength(1)
    // The remaining checks still ran.
    expect(keys(findings)).toEqual(['package.json:dependencies.next'])
  })
})
