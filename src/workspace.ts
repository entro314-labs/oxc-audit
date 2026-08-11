import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { isPathNotFoundError } from './fs-utils.js'

/** Directories that never contain workspace packages worth auditing. */
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
  'fixtures',
  '__fixtures__',
])
/** Deep enough for the usual `apps` and `packages` layouts, including one nested level. */
const DEFAULT_MAX_DEPTH = 4

export interface WorkspacePackage {
  /** Absolute path to the package directory. */
  dir: string
  /** Path relative to the workspace root, for display. */
  relativeDir: string
}

/**
 * Finds the packages inside a workspace root.
 *
 * Deliberately convention-agnostic: rather than parsing four different workspace
 * declarations (`package.json` workspaces, `pnpm-workspace.yaml`, `lerna.json`, `nx.json`,
 * each with its own glob dialect and one requiring a YAML parser), this treats "a
 * directory containing a package.json" as the definition of a package. That is a fact on
 * disk rather than a declaration to interpret, and it holds for every convention at once.
 *
 * The trade-off is that a package outside the declared globs is still found. Auditing it
 * is useful anyway — it is a real package with real source files.
 */
export async function findWorkspacePackages(
  rootDir: string,
  options: { maxDepth?: number } = {},
): Promise<WorkspacePackage[]> {
  const root = resolve(rootDir)
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const found: WorkspacePackage[] = []

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return
    }

    let entries
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch (err) {
      if (isPathNotFoundError(err)) {
        return
      }

      throw err
    }

    // The root itself is audited separately, so it is never reported as a package.
    if (currentDir !== root && entries.some((entry) => entry.name === 'package.json')) {
      found.push({ dir: currentDir, relativeDir: relative(root, currentDir) })
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !SKIPPED_DIRECTORIES.has(entry.name) &&
        !entry.name.startsWith('.')
      ) {
        await walk(join(currentDir, entry.name), depth + 1)
      }
    }
  }

  await walk(root, 0)

  // Sorted so a run is reproducible regardless of filesystem enumeration order.
  return found.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir))
}
