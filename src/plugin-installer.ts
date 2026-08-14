import { cp, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findClosestPackageJson, pathExists } from './fs-utils.js'
import type { Reporter } from './types.js'

/** Where the plugins land in a consuming project, matching the `audit-plugins` signal. */
export const VENDORED_PLUGIN_DIR = join('tools', 'oxlint', 'audit-plugins')

/**
 * Locate the plugin sources inside this package.
 *
 * `oxlint-plugin-audit` is not published separately; it ships inside `oxc-audit` and is
 * copied into the consuming project. Resolving from this module's own location works
 * whether the CLI is running from `dist/` or from source, and whether it was installed
 * into `node_modules` or linked.
 */
export async function findBundledPlugins(): Promise<string | undefined> {
  const manifestPath = await findClosestPackageJson(dirname(fileURLToPath(import.meta.url)))

  if (!manifestPath) {
    return undefined
  }

  const candidate = resolve(dirname(manifestPath), 'plugins', 'src')

  return (await pathExists(candidate)) ? candidate : undefined
}

/** Plugin directories inside a plugin source tree, ignoring the shared helpers. */
async function pluginNames(sourceDir: string): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
    .map((entry) => entry.name)
    .sort()
}

export interface PluginInstallResult {
  /** Where the plugins were copied to, project-relative. */
  destination: string
  installed: string[]
  /** True when the copy actually happened, as opposed to a dry run or an existing copy. */
  written: boolean
}

/**
 * Copy the bundled plugins into a project.
 *
 * Refuses to overwrite an existing copy. A vendored plugin directory is source the project
 * now owns — it may have been edited — and replacing it silently on a routine audit would
 * discard that.
 */
export async function installBundledPlugins(
  projectDir: string,
  reporter: Reporter,
  options: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<PluginInstallResult | undefined> {
  const source = await findBundledPlugins()

  if (!source) {
    reporter.error(
      'The bundled Oxlint plugins could not be found in this installation of oxc-audit, so there is nothing to copy.',
    )
    return undefined
  }

  const destination = resolve(projectDir, VENDORED_PLUGIN_DIR)
  const installed = await pluginNames(source)

  if (await pathExists(destination)) {
    reporter.info(`${VENDORED_PLUGIN_DIR} already exists; leaving it as it is.`)
    return { destination: VENDORED_PLUGIN_DIR, installed, written: false }
  }

  if (options.dryRun) {
    return { destination: VENDORED_PLUGIN_DIR, installed, written: false }
  }

  // `shared/` comes along with them: every plugin imports from it.
  await cp(source, destination, { recursive: true, filter: (path) => !path.endsWith('.test.ts') })
  reporter.info(`Copied ${installed.length} Oxlint plugin(s) to ${VENDORED_PLUGIN_DIR}`)

  return { destination: VENDORED_PLUGIN_DIR, installed, written: true }
}
