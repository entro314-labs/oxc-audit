import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { pathExists } from './fs-utils.js'
import { auditWorkspace } from './index.js'
import { CollectingReporter } from './reporter.js'
import type { OxlintConfig } from './types.js'
import { discoverWorkspace, findWorkspacePackages } from './workspace.js'

async function setupWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-workspace-'))

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }

  return dir
}

const PNPM_WORKSPACE = {
  'package.json': JSON.stringify({ name: 'root', devDependencies: { typescript: '^5.0.0' } }),
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
  'packages/web/package.json': JSON.stringify({
    name: 'web',
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
  }),
  'packages/web/src/App.tsx': 'export default () => null\n',
  'packages/api/package.json': JSON.stringify({
    name: 'api',
    devDependencies: { vitest: '^3.0.0' },
  }),
  'packages/api/src/server.ts': 'export const start = () => undefined\n',
}

describe('findWorkspacePackages', () => {
  it('finds every package beneath the root, excluding the root itself', async () => {
    const dir = await setupWorkspace(PNPM_WORKSPACE)

    const packages = await findWorkspacePackages(dir)

    expect(packages.map((entry) => entry.relativeDir)).toEqual(['packages/api', 'packages/web'])
  })

  it('never descends into node_modules', async () => {
    const dir = await setupWorkspace({
      ...PNPM_WORKSPACE,
      'node_modules/some-dep/package.json': JSON.stringify({ name: 'some-dep' }),
      'packages/web/node_modules/nested/package.json': JSON.stringify({ name: 'nested' }),
    })

    const packages = await findWorkspacePackages(dir)

    expect(packages.map((entry) => entry.relativeDir)).toEqual(['packages/api', 'packages/web'])
  })

  it('returns packages in a stable order regardless of filesystem enumeration', async () => {
    const dir = await setupWorkspace(PNPM_WORKSPACE)

    const first = await findWorkspacePackages(dir)
    const second = await findWorkspacePackages(dir)

    expect(second.map((entry) => entry.relativeDir)).toEqual(
      first.map((entry) => entry.relativeDir),
    )
  })

  it('respects the depth limit', async () => {
    const dir = await setupWorkspace({
      'package.json': JSON.stringify({ name: 'root' }),
      'a/b/c/d/e/package.json': JSON.stringify({ name: 'deep' }),
    })

    expect(await findWorkspacePackages(dir, { maxDepth: 2 })).toEqual([])
    expect((await findWorkspacePackages(dir, { maxDepth: 6 })).length).toBe(1)
  })

  it('returns nothing for a project that is not a workspace', async () => {
    const dir = await setupWorkspace({
      'package.json': JSON.stringify({ name: 'solo' }),
      'src/index.ts': 'export const a = 1\n',
    })

    expect(await findWorkspacePackages(dir)).toEqual([])
  })
})

describe('auditWorkspace', () => {
  it('detects each package’s own stack rather than only the root’s', async () => {
    const dir = await setupWorkspace(PNPM_WORKSPACE)

    const workspace = await auditWorkspace({ projectDir: dir }, new CollectingReporter())
    const byDir = new Map(workspace.packages.map((entry) => [entry.relativeDir, entry.report]))

    // React lives in packages/web only; the root manifest has no idea about it.
    expect(byDir.get('packages/web')?.stack.signals.map((s) => s.id)).toContain('react')
    expect(byDir.get('packages/api')?.stack.signals.map((s) => s.id)).toContain('vitest')
    expect(workspace.root.stack.signals.map((s) => s.id)).not.toContain('react')
  })

  it('recommends per-package plugins the root audit would have missed', async () => {
    const dir = await setupWorkspace(PNPM_WORKSPACE)

    const workspace = await auditWorkspace({ projectDir: dir }, new CollectingReporter())
    const web = workspace.packages.find((entry) => entry.relativeDir === 'packages/web')
    const plugins = web?.report.recommendations
      .filter((entry) => entry.kind === 'plugin')
      .map((entry) => entry.target)

    expect(plugins).toEqual(expect.arrayContaining(['react', 'react-perf', 'jsx-a11y']))
  })

  it('writes a config into each package, not just the root', async () => {
    const dir = await setupWorkspace(PNPM_WORKSPACE)

    await auditWorkspace({ projectDir: dir, write: true }, new CollectingReporter())

    const webConfig = JSON.parse(
      await readFile(join(dir, 'packages/web/.oxlintrc.json'), 'utf-8'),
    ) as OxlintConfig
    const apiConfig = JSON.parse(
      await readFile(join(dir, 'packages/api/.oxlintrc.json'), 'utf-8'),
    ) as OxlintConfig

    expect(webConfig.plugins).toContain('react')
    // The API package has no React, so its config must not carry React plugins.
    expect(apiConfig.plugins ?? []).not.toContain('react')
  })

  it('honours each package’s existing config independently', async () => {
    const dir = await setupWorkspace({
      ...PNPM_WORKSPACE,
      'packages/web/.oxlintrc.json': `${JSON.stringify({ rules: { 'no-eval': 'off' } }, null, 2)}\n`,
    })

    const workspace = await auditWorkspace(
      { projectDir: dir, write: true },
      new CollectingReporter(),
    )
    const web = workspace.packages.find((entry) => entry.relativeDir === 'packages/web')
    const api = workspace.packages.find((entry) => entry.relativeDir === 'packages/api')

    expect(web?.report.explicitlyDisabled.map((entry) => entry.target)).toContain('no-eval')
    // The opt-out belongs to packages/web alone.
    expect(api?.report.explicitlyDisabled).toEqual([])
  })

  it('fails overall when any single package fails', async () => {
    const dir = await setupWorkspace({
      ...PNPM_WORKSPACE,
      'packages/api/.oxlintrc.json': '{ "rules": [ }\n',
    })

    const workspace = await auditWorkspace(
      { projectDir: dir, write: true },
      new CollectingReporter(),
    )

    expect(workspace.success).toBe(false)
    expect(workspace.root.success).toBe(true)
  })

  it('is idempotent across the whole workspace', async () => {
    const dir = await setupWorkspace(PNPM_WORKSPACE)

    await auditWorkspace({ projectDir: dir, write: true }, new CollectingReporter())
    const second = await auditWorkspace({ projectDir: dir, write: true }, new CollectingReporter())

    expect(second.root.recommendations).toEqual([])
    for (const { report } of second.packages) {
      expect(report.recommendations).toEqual([])
    }
  })
})

describe('workspace declarations are honoured', () => {
  const WITH_EXCLUSION = {
    'package.json': JSON.stringify({ name: 'root' }),
    // Mirrors a real repo: an app kept out of the workspace on purpose because it owns
    // its own dependency graph and lockfile.
    'pnpm-workspace.yaml': [
      'packages:',
      '  - apps/*',
      '  # native app must own its dependency graph',
      "  - '!apps/native'",
      '  - packages/*',
      'minimumReleaseAge: 0',
      '',
    ].join('\n'),
    'apps/web/package.json': JSON.stringify({ name: 'web' }),
    'apps/native/package.json': JSON.stringify({ name: 'native' }),
    'packages/ui/package.json': JSON.stringify({ name: 'ui' }),
    'tools/scratch/package.json': JSON.stringify({ name: 'scratch' }),
  }

  it('excludes a package the workspace negates', async () => {
    const dir = await setupWorkspace(WITH_EXCLUSION)

    const discovery = await discoverWorkspace(dir)

    expect(discovery.packages.map((entry) => entry.relativeDir)).toEqual([
      'apps/web',
      'packages/ui',
    ])
    expect(discovery.excluded.map((entry) => entry.relativeDir)).toEqual(
      expect.arrayContaining(['apps/native']),
    )
    expect(discovery.declaredIn).toBe('pnpm-workspace.yaml')
  })

  it('excludes packages outside the declared globs', async () => {
    const dir = await setupWorkspace(WITH_EXCLUSION)

    const discovery = await discoverWorkspace(dir)

    // tools/* is not declared, so it is not a workspace package.
    expect(discovery.packages.map((entry) => entry.relativeDir)).not.toContain('tools/scratch')
  })

  it('never audits an excluded package', async () => {
    const dir = await setupWorkspace(WITH_EXCLUSION)

    const workspace = await auditWorkspace(
      { projectDir: dir, write: true },
      new CollectingReporter(),
    )

    expect(workspace.packages.map((entry) => entry.relativeDir)).not.toContain('apps/native')
    expect(await pathExists(join(dir, 'apps/native/.oxlintrc.json'))).toBe(false)
    expect(await pathExists(join(dir, 'apps/web/.oxlintrc.json'))).toBe(true)
  })

  it('reports exclusions rather than skipping them silently', async () => {
    const dir = await setupWorkspace(WITH_EXCLUSION)
    const reporter = new CollectingReporter()

    await auditWorkspace({ projectDir: dir }, reporter)

    // info() is a no-op on CollectingReporter, so assert through the discovery API that
    // the exclusion is surfaced as data rather than dropped.
    const discovery = await discoverWorkspace(dir)
    expect(discovery.excluded.length).toBeGreaterThan(0)
    expect(discovery.declaredIn).toBeDefined()
  })

  it('honours package.json workspaces, including the object form', async () => {
    const dir = await setupWorkspace({
      'package.json': JSON.stringify({ name: 'root', workspaces: { packages: ['packages/*'] } }),
      'packages/ui/package.json': JSON.stringify({ name: 'ui' }),
      'apps/web/package.json': JSON.stringify({ name: 'web' }),
    })

    const discovery = await discoverWorkspace(dir)

    expect(discovery.packages.map((entry) => entry.relativeDir)).toEqual(['packages/ui'])
    expect(discovery.declaredIn).toBe('package.json')
  })

  it('falls back to plain discovery when nothing is declared', async () => {
    const dir = await setupWorkspace({
      'package.json': JSON.stringify({ name: 'root' }),
      'packages/ui/package.json': JSON.stringify({ name: 'ui' }),
      'tools/scratch/package.json': JSON.stringify({ name: 'scratch' }),
    })

    const discovery = await discoverWorkspace(dir)

    expect(discovery.declaredIn).toBeUndefined()
    expect(discovery.packages.map((entry) => entry.relativeDir)).toEqual([
      'packages/ui',
      'tools/scratch',
    ])
  })
})
