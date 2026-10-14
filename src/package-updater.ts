import { dirname, resolve } from 'node:path'

import { z } from 'zod'

import {
  findClosestPackageJson,
  readJsonFilePreservingKeyOrder,
  writeTextFileAtomically,
} from './fs-utils.js'
import { AUDIT_PLUGINS_PACKAGE } from './stack-detector.js'
import type { PackageUpdate, Reporter } from './types.js'
import { compareVersions, minimumVersionOf, OXC_TOOL_VERSIONS } from './versions.js'

const PackageJsonSchema = z
  .object({
    scripts: z.record(z.string(), z.string()).optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  })
  .loose()

type PackageJson = z.infer<typeof PackageJsonSchema>

/**
 * Scripts a project needs to actually run what was just configured.
 *
 * A config nothing invokes is a config nobody runs. These are the conventional four names;
 * a project that already defines any of them keeps its own, because a `lint` script is very
 * often doing more than one thing and replacing it would silently drop the rest.
 */
interface ScriptTemplate {
  readonly name: string
  readonly command: (context: { typeAware: boolean }) => string
}

const SCRIPTS: ScriptTemplate[] = [
  { name: 'lint', command: ({ typeAware }) => `oxlint${typeAware ? ' --type-aware' : ''} .` },
  {
    name: 'lint:fix',
    command: ({ typeAware }) => `oxlint${typeAware ? ' --type-aware' : ''} --fix .`,
  },
  { name: 'format', command: () => 'oxfmt --write .' },
  { name: 'format:check', command: () => 'oxfmt --check .' },
]

/**
 * Tools the written config needs on disk before any of it runs.
 *
 * `@oxlint/plugins` is the runtime every js plugin imports; without it Oxlint fails to load
 * the plugin and refuses to start. The audit plugin package declares it as a dependency, so
 * a manifest naming that package already has the runtime and is not asked for it twice.
 */
function requiredTools(
  manifest: PackageJson,
  options: { typeAware: boolean; format: boolean; jsPlugins: boolean },
): string[] {
  return [
    'oxlint',
    ...(options.format ? ['oxfmt'] : []),
    ...(options.typeAware ? ['oxlint-tsgolint'] : []),
    ...(options.jsPlugins && !hasDependency(manifest, AUDIT_PLUGINS_PACKAGE)
      ? ['@oxlint/plugins']
      : []),
  ]
}

function hasDependency(manifest: PackageJson, name: string): boolean {
  return (
    manifest.dependencies?.[name] !== undefined || manifest.devDependencies?.[name] !== undefined
  )
}

/** The install command for the package manager the project already uses. */
export function installCommand(packageManager: string | undefined, packages: string[]): string {
  const specifiers = packages.join(' ')

  if (packageManager?.startsWith('yarn')) return `yarn add -D ${specifiers}`
  if (packageManager?.startsWith('npm')) return `npm install -D ${specifiers}`
  if (packageManager?.startsWith('bun')) return `bun add -d ${specifiers}`

  return `pnpm add -D ${specifiers}`
}

/**
 * Add the scripts and report the dependencies a project needs to run its new config.
 *
 * Additive, like everything else here: an existing script of the same name is a decision
 * and is left alone. Dependencies are reported rather than installed — running a package
 * manager is a side effect well beyond writing a config file, and the lockfile is the
 * project's to change.
 *
 * Dependencies are read from the closest manifest, which is the one the stack detector read
 * and the one an install would land in. Scripts are written only when that manifest is the
 * audited directory's own: a parent's manifest is outside the directory the user named and
 * outside the lock this run holds, and a `lint` script there would run against a tree the
 * config written here does not cover.
 */
export async function updatePackageJson(
  projectDir: string,
  reporter: Reporter,
  options: {
    write: boolean
    typeAware: boolean
    format: boolean
    jsPlugins: boolean
    /** From the manifest's `packageManager` field, or else its lockfile. */
    packageManager: string | undefined
    signal?: AbortSignal
  },
): Promise<PackageUpdate | undefined> {
  const packageJsonPath = await findClosestPackageJson(projectDir)

  if (!packageJsonPath) {
    return undefined
  }

  const ownManifest = dirname(packageJsonPath) === resolve(projectDir)

  let manifest: PackageJson
  try {
    // Written back in place, so key order has to survive the round trip.
    manifest = await readJsonFilePreservingKeyOrder(
      packageJsonPath,
      PackageJsonSchema,
      `package manifest at ${packageJsonPath}`,
    )
  } catch (err) {
    reporter.warn(
      `Could not read ${packageJsonPath}: ${err instanceof Error ? err.message : String(err)}. Scripts were not updated.`,
    )
    return undefined
  }

  const scripts = { ...manifest.scripts }
  const scriptsAdded: string[] = []

  for (const { name, command } of SCRIPTS) {
    if (!ownManifest) {
      break
    }

    if (name === 'format' || name === 'format:check') {
      if (!options.format) {
        continue
      }
    }

    if (scripts[name] !== undefined) {
      continue
    }

    scripts[name] = command({ typeAware: options.typeAware })
    scriptsAdded.push(name)
  }

  const required = requiredTools(manifest, options)
  const missingDependencies = required.filter((tool) => !hasDependency(manifest, tool))
  const outdated = required.flatMap((tool) => {
    const range = manifest.devDependencies?.[tool] ?? manifest.dependencies?.[tool]
    const needed = OXC_TOOL_VERSIONS[tool]
    const minimum = range === undefined ? null : minimumVersionOf(range)

    return needed !== undefined && minimum !== null && compareVersions(minimum, needed) < 0
      ? [{ tool, range: range ?? '', needed }]
      : []
  })
  const { packageManager } = options

  let written = false

  if (options.write && scriptsAdded.length > 0) {
    try {
      const next = { ...manifest, scripts }
      await writeTextFileAtomically(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`, {
        signal: options.signal,
      })
      written = true
      reporter.info(`Added ${scriptsAdded.length} script(s) to ${packageJsonPath}`)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }

      reporter.error(
        `Failed to write ${packageJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return {
    path: packageJsonPath,
    scriptsAdded,
    written,
    missingDependencies,
    installCommand:
      missingDependencies.length > 0
        ? installCommand(packageManager, missingDependencies)
        : undefined,
    outdatedDependencies: outdated.map(({ tool, range }) => `${tool} ${range}`),
    upgradeCommand:
      outdated.length > 0
        ? installCommand(
            packageManager,
            outdated.map(({ tool, needed }) => `${tool}@^${needed}`),
          )
        : undefined,
  }
}
