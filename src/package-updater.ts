import { z } from 'zod'

import {
  findClosestPackageJson,
  readJsonFilePreservingKeyOrder,
  writeTextFileAtomically,
} from './fs-utils.js'
import type { PackageUpdate, Reporter } from './types.js'

const PackageJsonSchema = z
  .object({
    scripts: z.record(z.string(), z.string()).optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()

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
 * `@oxlint/plugins` is listed whenever the config registers a js plugin: every plugin
 * imports it, and without it Oxlint fails to load the plugin and refuses to start.
 */
function requiredTools(options: {
  typeAware: boolean
  format: boolean
  jsPlugins: boolean
}): string[] {
  return [
    'oxlint',
    ...(options.format ? ['oxfmt'] : []),
    ...(options.typeAware ? ['oxlint-tsgolint'] : []),
    ...(options.jsPlugins ? ['@oxlint/plugins'] : []),
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
 */
export async function updatePackageJson(
  projectDir: string,
  reporter: Reporter,
  options: {
    write: boolean
    typeAware: boolean
    format: boolean
    jsPlugins: boolean
    signal?: AbortSignal
  },
): Promise<PackageUpdate | undefined> {
  const packageJsonPath = await findClosestPackageJson(projectDir)

  if (!packageJsonPath) {
    return undefined
  }

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

  const missingDependencies = requiredTools(options).filter(
    (tool) => !hasDependency(manifest, tool),
  )
  const packageManager =
    typeof manifest.packageManager === 'string' ? manifest.packageManager : undefined

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
  }
}
