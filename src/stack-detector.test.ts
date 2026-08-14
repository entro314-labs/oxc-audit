import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CollectingReporter } from './reporter.js'
import { detectStack, hasSignal } from './stack-detector.js'
import type { StackSignalId } from './types.js'

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-detect-'))

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }

  return dir
}

function signalIds(signals: Array<{ id: StackSignalId }>): StackSignalId[] {
  return signals.map((signal) => signal.id)
}

describe('detectStack', () => {
  it('reads signals from declared dependencies', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', next: '^15.0.0' },
        devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' },
      }),
    })

    const stack = await detectStack(dir, new CollectingReporter())

    expect(signalIds(stack.signals)).toEqual(
      expect.arrayContaining(['react', 'react-dom', 'nextjs', 'typescript', 'vitest']),
    )
  })

  it('records the evidence behind each signal', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { vue: '^3.0.0' } }),
      'src/App.vue': '<template><div /></template>\n',
    })

    const stack = await detectStack(dir, new CollectingReporter())
    const vue = stack.signals.find((signal) => signal.id === 'vue')

    expect(vue?.evidence).toEqual(
      expect.arrayContaining([
        { kind: 'dependency', value: 'vue' },
        { kind: 'source-extension', value: '.vue' },
      ]),
    )
  })

  it('reads signals from config files when the dependency is not declared locally', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'leaf' }),
      'tsconfig.json': '{}',
      'next.config.mjs': 'export default {}\n',
      'vitest.config.ts': 'export default {}\n',
    })

    const stack = await detectStack(dir, new CollectingReporter())

    expect(signalIds(stack.signals)).toEqual(
      expect.arrayContaining(['typescript', 'nextjs', 'vitest']),
    )
  })

  it('reads jsx and typescript from the source tree', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app' }),
      'src/Button.tsx': 'export const Button = () => null\n',
    })

    const stack = await detectStack(dir, new CollectingReporter())

    expect(hasSignal(stack, 'jsx')).toBe(true)
    expect(hasSignal(stack, 'typescript')).toBe(true)
    expect(stack.sourceExtensions).toContain('.tsx')
  })

  it('reads esm, monorepo and node signals from manifest fields', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({
        name: 'root',
        type: 'module',
        workspaces: ['packages/*'],
        engines: { node: '>=24' },
      }),
    })

    const stack = await detectStack(dir, new CollectingReporter())

    expect(signalIds(stack.signals)).toEqual(expect.arrayContaining(['esm', 'monorepo', 'node']))
  })

  it('never walks into dependency or build directories', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app' }),
      'src/index.ts': 'export const a = 1\n',
      'node_modules/react/index.jsx': 'module.exports = {}\n',
      'dist/bundle.jsx': 'export default 1\n',
      '.git/hooks/pre-commit.js': '#!/bin/sh\n',
    })

    const stack = await detectStack(dir, new CollectingReporter())

    // Only src/index.ts is real source; the .jsx files are in skipped directories.
    expect(hasSignal(stack, 'jsx')).toBe(false)
    expect(stack.sourceExtensions).toEqual(['.ts'])
  })

  it('reports truncation instead of silently scanning a partial tree', async () => {
    const files: Record<string, string> = { 'package.json': JSON.stringify({ name: 'big' }) }
    for (let index = 0; index < 30; index++) {
      files[`src/file-${index}.ts`] = 'export const a = 1\n'
    }
    const dir = await setupProject(files)
    const reporter = new CollectingReporter()

    const stack = await detectStack(dir, reporter, { maxFiles: 5 })

    expect(stack.scanTruncated).toBe(true)
    expect(reporter.getWarnings().some((warning) => warning.includes('Source scan stopped'))).toBe(
      true,
    )
  })

  it('degrades to file-based signals when there is no package.json', async () => {
    const dir = await setupProject({ 'src/index.ts': 'export const a = 1\n' })
    const reporter = new CollectingReporter()

    const stack = await detectStack(dir, reporter)

    expect(hasSignal(stack, 'typescript')).toBe(true)
    expect(reporter.getWarnings().some((warning) => warning.includes('No package.json'))).toBe(true)
  })

  it('produces identical output for identical input', async () => {
    const files = {
      'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } }),
      'src/App.tsx': 'export default () => null\n',
    }
    const reporter = new CollectingReporter()

    const first = await detectStack(await setupProject(files), reporter)
    const second = await detectStack(await setupProject(files), reporter)

    expect(signalIds(second.signals)).toEqual(signalIds(first.signals))
    expect(second.sourceExtensions).toEqual(first.sourceExtensions)
  })
})

describe('detectStack - workspace roots', () => {
  it('detects a pnpm workspace, which declares itself outside package.json', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'root' }),
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    })

    const stack = await detectStack(dir, new CollectingReporter())

    expect(hasSignal(stack, 'monorepo')).toBe(true)
  })

  it('detects Lerna and Nx workspaces', async () => {
    for (const marker of ['lerna.json', 'nx.json']) {
      const dir = await setupProject({
        'package.json': JSON.stringify({ name: 'root' }),
        [marker]: '{}',
      })

      const stack = await detectStack(dir, new CollectingReporter())

      expect(hasSignal(stack, 'monorepo')).toBe(true)
    }
  })

  it('warns that a workspace root under-reports its packages', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'root' }),
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/app/src/App.tsx': 'export default () => null\n',
    })
    const reporter = new CollectingReporter()

    await detectStack(dir, reporter)

    expect(reporter.getWarnings().some((warning) => warning.includes('workspace root'))).toBe(true)
  })
})
