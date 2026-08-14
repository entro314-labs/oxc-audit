import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { isPathNotFoundError } from './fs-utils.js'
import { matchesDeclaration, readWorkspaceDeclaration } from './workspace-globs.js'

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

export interface WorkspaceDiscovery {
  packages: WorkspacePackage[]
  /** The file the package globs came from, when the workspace declared them. */
  declaredIn: string | undefined
  /** Packages found on disk but excluded by the workspace declaration. */
  excluded: WorkspacePackage[]
}

/**
 * Finds the packages inside a workspace root.
 *
 * Discovery walks for `package.json`, which works regardless of which workspace
 * convention a repo uses. When the repo *declares* its packages, that declaration then
 * filters the result - including its exclusions.
 *
 * Honouring exclusions is the point. A repo can keep a package out of its workspace
 * deliberately (a React Native app that must own its own dependency graph, for instance,
 * carrying its own lockfile). Auditing it anyway would write config into a package the
 * repo has explicitly set apart, which is exactly the unrequested change this tool avoids
 * everywhere else.
 */
export async function findWorkspacePackages(
  rootDir: string,
  options: { maxDepth?: number } = {},
): Promise<WorkspacePackage[]> {
  return (await discoverWorkspace(rootDir, options)).packages
}

/** Like {@link findWorkspacePackages}, but reports what was excluded and why. */
export async function discoverWorkspace(
  rootDir: string,
  options: { maxDepth?: number } = {},
): Promise<WorkspaceDiscovery> {
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
  found.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir))

  const declaration = await readWorkspaceDeclaration(root)

  if (!declaration) {
    return { packages: found, declaredIn: undefined, excluded: [] }
  }

  const packages: WorkspacePackage[] = []
  const excluded: WorkspacePackage[] = []

  for (const workspacePackage of found) {
    if (matchesDeclaration(workspacePackage.relativeDir, declaration)) {
      packages.push(workspacePackage)
      continue
    }

    excluded.push(workspacePackage)
  }

  return { packages, declaredIn: declaration.source, excluded }
}
