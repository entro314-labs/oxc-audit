import { readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import { z } from 'zod'

import {
  findClosestPackageJson,
  isPathNotFoundError,
  pathExists,
  readJsonFile,
} from './fs-utils.js'
import type { Evidence, ProjectStack, Reporter, StackSignal, StackSignalId } from './types.js'

/** Directories never worth walking; skipping them keeps the scan bounded and fast. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'vendor',
  '__snapshots__',
])
const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.vue',
  '.astro',
  '.svelte',
])
const DEFAULT_MAX_FILES = 5000

const PackageManifestSchema = z
  .object({
    type: z.string().optional(),
    bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
    engines: z.record(z.string(), z.string()).optional(),
    workspaces: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()

type PackageManifest = z.infer<typeof PackageManifestSchema>

/**
 * Config files whose mere presence establishes a signal, for projects that configure a
 * tool without listing it as a direct dependency (common in monorepo leaf packages).
 */
const CONFIG_FILE_SIGNALS: Array<{ id: StackSignalId; files: string[] }> = [
  { id: 'typescript', files: ['tsconfig.json', 'tsconfig.base.json'] },
  // Tracked separately from `typescript`: type-aware linting needs a real tsconfig, not
  // just TypeScript source files.
  { id: 'tsconfig', files: ['tsconfig.json'] },
  { id: 'svelte', files: ['svelte.config.js', 'svelte.config.ts', 'svelte.config.mjs'] },
  { id: 'astro', files: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'] },
  {
    id: 'nextjs',
    files: ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.mts'],
  },
  { id: 'vue', files: ['vue.config.js', 'vue.config.ts', 'nuxt.config.ts', 'nuxt.config.js'] },
  {
    id: 'vitest',
    files: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.workspace.ts'],
  },
  { id: 'jest', files: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'] },
  // `package.json#workspaces` is only one of several conventions; pnpm, Lerna and Nx each
  // declare a workspace somewhere else entirely.
  { id: 'monorepo', files: ['pnpm-workspace.yaml', 'pnpm-workspace.yml', 'lerna.json', 'nx.json'] },
]

/** Dependency names that establish a signal, matched exactly. */
const DEPENDENCY_SIGNALS: Array<{ id: StackSignalId; packages: string[] }> = [
  { id: 'typescript', packages: ['typescript', '@typescript/native-preview'] },
  { id: 'react', packages: ['react'] },
  { id: 'react-dom', packages: ['react-dom'] },
  { id: 'nextjs', packages: ['next'] },
  { id: 'vue', packages: ['vue', 'nuxt'] },
  { id: 'vitest', packages: ['vitest'] },
  { id: 'jest', packages: ['jest', '@jest/globals'] },
  { id: 'node', packages: ['@types/node'] },
  { id: 'jsdoc', packages: ['jsdoc', 'typedoc'] },
  { id: 'svelte', packages: ['svelte'] },
  { id: 'astro', packages: ['astro'] },
  // The engine behind Oxlint's type-aware rules. Without it `oxlint --type-aware` fails
  // with "Failed to find tsgolint executable", so its presence gates those rules.
  { id: 'tsgolint', packages: ['oxlint-tsgolint'] },
]

/** Extensions that establish a signal by their presence in the source tree. */
const EXTENSION_SIGNALS: Array<{ id: StackSignalId; extensions: string[] }> = [
  { id: 'typescript', extensions: ['.ts', '.tsx', '.mts', '.cts'] },
  { id: 'jsx', extensions: ['.jsx', '.tsx'] },
  { id: 'vue', extensions: ['.vue'] },
  { id: 'svelte', extensions: ['.svelte'] },
  { id: 'astro', extensions: ['.astro'] },
]

/**
 * Reads the project's stack off disk.
 *
 * Every signal is a fact — a declared dependency, a config file that exists, an extension
 * actually present in the tree — recorded with the evidence that established it. Nothing
 * here infers or guesses, so the same project always produces the same stack.
 */
export async function detectStack(
  projectDir: string,
  reporter: Reporter,
  options: { maxFiles?: number } = {},
): Promise<ProjectStack> {
  const resolvedDir = resolve(projectDir)
  const packageJsonPath = await findClosestPackageJson(resolvedDir)
  const manifest = await readManifest(packageJsonPath, reporter)
  const evidenceBySignal = new Map<StackSignalId, Evidence[]>()

  const addEvidence = (id: StackSignalId, evidence: Evidence): void => {
    const existing = evidenceBySignal.get(id)

    if (existing) {
      existing.push(evidence)
      return
    }

    evidenceBySignal.set(id, [evidence])
  }

  collectDependencySignals(manifest, addEvidence)
  collectManifestFieldSignals(manifest, addEvidence)
  await collectConfigFileSignals(resolvedDir, addEvidence)

  const scan = await scanSourceTree(resolvedDir, options.maxFiles ?? DEFAULT_MAX_FILES)
  collectExtensionSignals(scan.extensions, addEvidence)

  // Dependency signals come from one manifest. In a workspace root the frameworks live in
  // the leaf packages, so a root-level audit under-reports and the user needs to know.
  if (evidenceBySignal.has('monorepo')) {
    reporter.warn(
      'This looks like a workspace root. Dependency signals come from the root manifest only, so frameworks used in individual packages will be missed. Run the audit per package with --dir, or keep a config per package.',
    )
  }

  if (scan.truncated) {
    reporter.warn(
      `Source scan stopped at ${scan.filesScanned} files; extension-based signals may be incomplete. Raise --max-files to scan the whole tree.`,
    )
  }

  const signals: StackSignal[] = [...evidenceBySignal.entries()]
    .map(([id, evidence]) => ({ id, evidence }))
    .sort((left, right) => left.id.localeCompare(right.id))

  reporter.info(
    signals.length > 0
      ? `Detected: ${signals.map((signal) => signal.id).join(', ')}`
      : 'No stack signals detected.',
  )

  return {
    projectDir: resolvedDir,
    packageJsonPath,
    signals,
    sourceExtensions: [...scan.extensions].sort(),
    filesScanned: scan.filesScanned,
    scanTruncated: scan.truncated,
  }
}

/** True when the stack carries the given signal. */
export function hasSignal(stack: ProjectStack, id: StackSignalId): boolean {
  return stack.signals.some((signal) => signal.id === id)
}

async function readManifest(
  packageJsonPath: string | undefined,
  reporter: Reporter,
): Promise<PackageManifest | undefined> {
  if (!packageJsonPath) {
    reporter.warn('No package.json found; dependency-based signals are unavailable.')
    return undefined
  }

  try {
    return await readJsonFile(
      packageJsonPath,
      PackageManifestSchema,
      `package manifest at ${packageJsonPath}`,
    )
  } catch (err) {
    reporter.warn(
      `Could not read ${packageJsonPath}: ${err instanceof Error ? err.message : String(err)}. Dependency-based signals are unavailable.`,
    )
    return undefined
  }
}

function collectDependencySignals(
  manifest: PackageManifest | undefined,
  addEvidence: (id: StackSignalId, evidence: Evidence) => void,
): void {
  if (!manifest) {
    return
  }

  const groups = [
    { kind: 'dependency' as const, entries: manifest.dependencies },
    { kind: 'dev-dependency' as const, entries: manifest.devDependencies },
    { kind: 'peer-dependency' as const, entries: manifest.peerDependencies },
  ]

  for (const { kind, entries } of groups) {
    for (const dependencyName of Object.keys(entries ?? {})) {
      for (const { id, packages } of DEPENDENCY_SIGNALS) {
        if (packages.includes(dependencyName)) {
          addEvidence(id, { kind, value: dependencyName })
        }
      }
    }
  }
}

function collectManifestFieldSignals(
  manifest: PackageManifest | undefined,
  addEvidence: (id: StackSignalId, evidence: Evidence) => void,
): void {
  if (!manifest) {
    return
  }

  if (manifest.type === 'module') {
    addEvidence('esm', { kind: 'config-file', value: 'package.json#type=module' })
  }

  if (manifest.workspaces !== undefined) {
    addEvidence('monorepo', { kind: 'config-file', value: 'package.json#workspaces' })
  }

  if (manifest.engines?.node !== undefined) {
    addEvidence('node', { kind: 'config-file', value: 'package.json#engines.node' })
  }

  if (manifest.bin !== undefined) {
    addEvidence('node', { kind: 'config-file', value: 'package.json#bin' })
  }
}

async function collectConfigFileSignals(
  projectDir: string,
  addEvidence: (id: StackSignalId, evidence: Evidence) => void,
): Promise<void> {
  for (const { id, files } of CONFIG_FILE_SIGNALS) {
    for (const fileName of files) {
      if (await pathExists(join(projectDir, fileName))) {
        addEvidence(id, { kind: 'config-file', value: fileName })
      }
    }
  }
}

function collectExtensionSignals(
  extensions: Set<string>,
  addEvidence: (id: StackSignalId, evidence: Evidence) => void,
): void {
  for (const { id, extensions: signalExtensions } of EXTENSION_SIGNALS) {
    for (const extension of signalExtensions) {
      if (extensions.has(extension)) {
        addEvidence(id, { kind: 'source-extension', value: extension })
      }
    }
  }
}

interface SourceScan {
  extensions: Set<string>
  filesScanned: number
  truncated: boolean
}

/** Walks the source tree breadth-first, collecting which source extensions exist. */
async function scanSourceTree(projectDir: string, maxFiles: number): Promise<SourceScan> {
  const extensions = new Set<string>()
  const queue: string[] = [projectDir]
  let filesScanned = 0

  while (queue.length > 0) {
    const currentDir = queue.shift()

    if (currentDir === undefined) {
      break
    }

    let entries
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch (err) {
      if (isPathNotFoundError(err)) {
        continue
      }

      throw err
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push(join(currentDir, entry.name))
        }
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      filesScanned += 1

      const extension = extname(entry.name)
      if (SOURCE_EXTENSIONS.has(extension)) {
        extensions.add(extension)
      }

      if (filesScanned >= maxFiles) {
        return { extensions, filesScanned, truncated: true }
      }
    }
  }

  return { extensions, filesScanned, truncated: false }
}
