import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as parseJsonc } from 'jsonc-parser'
import type { ParseError as JsoncParseError } from 'jsonc-parser'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { isPathNotFoundError, pathExists } from './fs-utils.js'
import type { ConfigFinding, ConfigFindingSeverity, Reporter } from './types.js'

/**
 * Deterministic checks over the project's configuration files.
 *
 * Oxlint only sees JavaScript and TypeScript source, so every finding here is one an Oxlint
 * plugin structurally cannot reach: a stale `turbo.json` key, a pnpm option that moved, a
 * `tsconfig` field a framework now warns about, or a dependency pinned below a security
 * floor. Each check reads a fact off disk - none infers, and none writes.
 */

/** Every config file this module knows how to read. */
const TURBO_CONFIG = 'turbo.json'
const PNPM_WORKSPACE = 'pnpm-workspace.yaml'
const TSCONFIG = 'tsconfig.json'
const PACKAGE_JSON = 'package.json'

const UnknownRecord = z.record(z.string(), z.unknown())

const TurboConfigSchema = z
  .object({
    pipeline: UnknownRecord.optional(),
    tasks: UnknownRecord.optional(),
  })
  .loose()

const TsconfigSchema = z
  .object({
    compilerOptions: z
      .object({
        baseUrl: z.string().optional(),
        moduleResolution: z.string().optional(),
        strict: z.boolean().optional(),
      })
      .loose()
      .optional(),
  })
  .loose()

const PackageManifestSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    engines: z.record(z.string(), z.string()).optional(),
  })
  .loose()

/** pnpm settings that moved or were removed in pnpm 11, with what replaced them. */
const PNPM_MOVED_KEYS: ReadonlyArray<{ key: string; replacement: string }> = [
  { key: 'onlyBuiltDependencies', replacement: 'the `allowBuilds` map' },
  { key: 'neverBuiltDependencies', replacement: 'the `allowBuilds` map' },
  { key: 'ignoredBuiltDependencies', replacement: 'the `allowBuilds` map' },
  { key: 'onlyBuiltDependenciesFile', replacement: 'the `allowBuilds` map' },
  { key: 'ignoreDepScripts', replacement: 'the `allowBuilds` map' },
  {
    key: 'allowNonAppliedPatches',
    replacement: '`allowUnusedPatches` - patch failures now throw',
  },
  { key: 'ignorePatchFailures', replacement: '`allowUnusedPatches` - patch failures now throw' },
]

/**
 * pnpm 11 supply-chain defaults. Each is on by default, so an explicit `false` is a
 * deliberate weakening worth surfacing rather than a stale setting.
 */
const PNPM_PROTECTIVE_DEFAULTS: ReadonlyArray<{ key: string; detail: string }> = [
  {
    key: 'blockExoticSubdeps',
    detail:
      'blocks transitive dependencies resolved from git, tarball and other non-registry sources',
  },
  { key: 'strictDepBuilds', detail: 'fails the install when a dependency build is skipped' },
]

/**
 * Published security floors: the lowest version of each package that carries the fix.
 *
 * Sourced from the audit prompts and dated to the 2026-08-12 sweep. A version below the
 * floor is a known-vulnerable dependency, not a style preference.
 */
const SECURITY_FLOORS: ReadonlyArray<{
  name: string
  floor: string
  advisory: string
}> = [
  { name: 'next', floor: '16.2.11', advisory: 'the July 2026 monthly set, CVE-2026-64641..64649' },
  { name: 'ai', floor: '7.0.42', advisory: 'SSRF via DNS rebinding in validated downloads' },
  {
    name: 'react-hook-form',
    floor: '7.69.0',
    advisory: 'CVE-2025-67779 / 55184 / 55183 / 55182',
  },
  {
    name: 'drizzle-orm',
    floor: '0.45.2',
    advisory: 'CWE-89 via unsanitised `sql.identifier()` / `sql.as()`',
  },
  {
    name: 'zustand',
    floor: '5.0.11',
    advisory: 'the `persist` middleware reaching for global `localStorage`',
  },
]

/** Task names whose output is a build artefact, where a missing `outputs` disables caching. */
const BUILD_TASK_NAMES = new Set(['build', 'bundle', 'compile', 'package'])

/**
 * Parses a config file that may legally contain comments.
 *
 * `tsconfig.json` is JSONC by convention and `turbo.json` tolerates comments too, so strict
 * `JSON.parse` would reject perfectly valid files and skip their checks.
 */
function parseConfigJson(text: string): unknown {
  const errors: JsoncParseError[] = []
  const parsed: unknown = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0) throw new Error('malformed JSON')
  return parsed
}

function finding(
  severity: ConfigFindingSeverity,
  file: string,
  key: string,
  title: string,
  detail: string,
): ConfigFinding {
  return { severity, file, key, title, detail }
}

/**
 * Reads a config file, returning `null` when it is absent.
 *
 * A parse failure is reported and treated as absent: a malformed `turbo.json` is the
 * project's problem to fix, and should not abort the rest of the audit.
 */
async function readOptional<T>(
  path: string,
  parse: (text: string) => unknown,
  schema: z.ZodType<T>,
  label: string,
  reporter: Reporter,
): Promise<T | null> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch (err) {
    if (isPathNotFoundError(err)) return null
    throw err
  }

  let parsed: unknown
  try {
    parsed = parse(text)
  } catch (err) {
    reporter.warn(`${label} could not be parsed, so its checks were skipped: ${String(err)}`)
    return null
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    reporter.warn(`${label} did not match the expected shape, so its checks were skipped.`)
    return null
  }

  return result.data
}

function auditTurboConfig(config: z.infer<typeof TurboConfigSchema>): ConfigFinding[] {
  const findings: ConfigFinding[] = []

  if (config.pipeline !== undefined) {
    findings.push(
      finding(
        'error',
        TURBO_CONFIG,
        'pipeline',
        'Turborepo 1.x `pipeline` key',
        'Turborepo 2 renamed `pipeline` to `tasks`. Run `npx @turbo/codemod migrate`.',
      ),
    )
  }

  const tasks = config.tasks ?? config.pipeline
  if (tasks === undefined) return findings

  for (const [name, definition] of Object.entries(tasks)) {
    if (definition === null || typeof definition !== 'object') continue
    const task = definition as Record<string, unknown>
    const bareName = name.includes('#') ? (name.split('#')[1] ?? name) : name

    if (task.cache === false) {
      findings.push(
        finding(
          'warning',
          TURBO_CONFIG,
          `tasks.${name}.cache`,
          'Caching disabled',
          `\`${name}\` sets \`cache: false\`, so it re-runs in full on every invocation. If the task is deterministic, declare its \`outputs\` and let it cache.`,
        ),
      )
      continue
    }

    if (BUILD_TASK_NAMES.has(bareName) && task.outputs === undefined) {
      findings.push(
        finding(
          'warning',
          TURBO_CONFIG,
          `tasks.${name}.outputs`,
          'Build task declares no outputs',
          `\`${name}\` has no \`outputs\`, so Turborepo caches nothing for it and a cache hit restores no artefacts. Declare the build directories, or \`outputs: []\` if it genuinely produces none.`,
        ),
      )
    }
  }

  return findings
}

function auditPnpmWorkspace(config: Record<string, unknown>): ConfigFinding[] {
  const findings: ConfigFinding[] = []

  for (const { key, replacement } of PNPM_MOVED_KEYS) {
    if (config[key] === undefined) continue
    findings.push(
      finding(
        'error',
        PNPM_WORKSPACE,
        key,
        'Setting removed in pnpm 11',
        `\`${key}\` was consolidated in pnpm 11 and is no longer read. Use ${replacement}, or apply the \`pnpm-v10-to-v11\` codemod.`,
      ),
    )
  }

  const { auditConfig } = config
  if (auditConfig !== null && typeof auditConfig === 'object') {
    if ('ignoreCves' in auditConfig) {
      findings.push(
        finding(
          'error',
          PNPM_WORKSPACE,
          'auditConfig.ignoreCves',
          'Advisory ignore list moved',
          'pnpm 11 reads `auditConfig.ignoreGhsas` against the GHSA bulk advisories endpoint. `ignoreCves` entries are silently ignored, so those advisories now surface again - or, worse, were never suppressed as intended.',
        ),
      )
    }
  }

  if (config.minimumReleaseAge === 0) {
    findings.push(
      finding(
        'warning',
        PNPM_WORKSPACE,
        'minimumReleaseAge',
        'Supply-chain delay disabled',
        'pnpm 11 defaults `minimumReleaseAge` to 1440 (one day) so a compromised release has time to be pulled before it is installed. An explicit `0` opts out of that.',
      ),
    )
  }

  for (const { key, detail } of PNPM_PROTECTIVE_DEFAULTS) {
    if (config[key] !== false) continue
    findings.push(
      finding(
        'warning',
        PNPM_WORKSPACE,
        key,
        'Protective default turned off',
        `\`${key}\` is \`true\` by default in pnpm 11, where it ${detail}. Setting it to \`false\` opts out.`,
      ),
    )
  }

  return findings
}

function auditTsconfig(
  config: z.infer<typeof TsconfigSchema>,
  hasNextjs: boolean,
): ConfigFinding[] {
  const findings: ConfigFinding[] = []
  const options = config.compilerOptions
  if (options === undefined) return findings

  // Next.js 16.3 stopped suppressing these two warnings, so they became visible rather than
  // newly wrong. Outside Next.js they are merely dated, which is not worth a finding.
  if (hasNextjs && options.baseUrl !== undefined) {
    findings.push(
      finding(
        'warning',
        TSCONFIG,
        'compilerOptions.baseUrl',
        'Deprecated compiler option now surfaced',
        'Next.js 16.3 stopped suppressing the `baseUrl` deprecation warning. Use `paths` relative to the tsconfig instead.',
      ),
    )
  }

  if (hasNextjs && options.moduleResolution?.toLowerCase() === 'node') {
    findings.push(
      finding(
        'warning',
        TSCONFIG,
        'compilerOptions.moduleResolution',
        'Deprecated compiler option now surfaced',
        'Next.js 16.3 stopped suppressing the `moduleResolution: "node"` deprecation warning. Use `"bundler"` or `"nodenext"`.',
      ),
    )
  }

  if (options.strict !== true) {
    findings.push(
      finding(
        'warning',
        TSCONFIG,
        'compilerOptions.strict',
        'Strict mode off',
        'Without `strict: true` the type-aware Oxlint rules have far less to work with: unchecked null access and implicit `any` stop being errors, so the findings never appear.',
      ),
    )
  }

  return findings
}

/**
 * The lowest version a range can resolve to.
 *
 * Handles the forms a manifest actually contains (`^1.2.3`, `~1.2.3`, `>=1.2.3`, `1.2.3`,
 * `1.2.3 - 2.0.0`) and returns `null` for anything else, so an unparsed range is skipped
 * rather than guessed at.
 */
export function minimumVersionOf(range: string): string | null {
  const match = /^\s*(?:[\^~]|>=?)?\s*(\d+)\.(\d+)\.(\d+)/.exec(range)
  if (match === null) return null
  return `${match[1]}.${match[2]}.${match[3]}`
}

/** Negative when `a` is lower than `b`. Both must be plain `x.y.z` triples. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function auditSecurityFloors(manifest: z.infer<typeof PackageManifestSchema>): ConfigFinding[] {
  const findings: ConfigFinding[] = []
  const declared = { ...manifest.dependencies, ...manifest.devDependencies }

  for (const { name, floor, advisory } of SECURITY_FLOORS) {
    const range = declared[name]
    if (range === undefined) continue

    const minimum = minimumVersionOf(range)
    if (minimum === null) {
      findings.push(
        finding(
          'info',
          PACKAGE_JSON,
          `dependencies.${name}`,
          'Version range not comparable',
          `\`${name}\` is pinned as \`${range}\`, which this check cannot reduce to a minimum version. Confirm by hand that it resolves to at least ${floor} (${advisory}).`,
        ),
      )
      continue
    }

    if (compareVersions(minimum, floor) >= 0) continue
    findings.push(
      finding(
        'error',
        PACKAGE_JSON,
        `dependencies.${name}`,
        'Dependency below its security floor',
        `\`${name}@${range}\` can resolve to ${minimum}, below the ${floor} floor that fixes ${advisory}. Raise the range.`,
      ),
    )
  }

  return findings
}

/** Node floors required by packages that raised their engine requirement. */
const NODE_FLOORS: ReadonlyArray<{ name: string; nodeFloor: string; reason: string }> = [
  { name: 'ai', nodeFloor: '22.0.0', reason: 'AI SDK v7 is ESM-only and requires Node >= 22' },
  { name: 'pnpm', nodeFloor: '22.0.0', reason: 'pnpm 11 is pure ESM and requires Node >= 22' },
]

function auditEngines(manifest: z.infer<typeof PackageManifestSchema>): ConfigFinding[] {
  const declaredNode = manifest.engines?.node
  if (declaredNode === undefined) return []

  const minimumNode = minimumVersionOf(declaredNode)
  if (minimumNode === null) return []

  const declared = { ...manifest.dependencies, ...manifest.devDependencies }
  const findings: ConfigFinding[] = []

  for (const { name, nodeFloor, reason } of NODE_FLOORS) {
    if (declared[name] === undefined) continue
    if (compareVersions(minimumNode, nodeFloor) >= 0) continue
    findings.push(
      finding(
        'error',
        PACKAGE_JSON,
        'engines.node',
        'Declared Node version too low for a dependency',
        `\`engines.node\` allows ${minimumNode}, but ${reason}. Raise the floor to >= ${nodeFloor}.`,
      ),
    )
  }

  return findings
}

/**
 * Runs every configuration check that applies to `projectDir`.
 *
 * Absent files are skipped silently - a project without `turbo.json` is not a monorepo, not
 * a misconfigured one.
 */
export async function auditConfigFiles(
  projectDir: string,
  reporter: Reporter,
): Promise<ConfigFinding[]> {
  const findings: ConfigFinding[] = []

  const turbo = await readOptional(
    join(projectDir, TURBO_CONFIG),
    parseConfigJson,
    TurboConfigSchema,
    TURBO_CONFIG,
    reporter,
  )
  if (turbo !== null) findings.push(...auditTurboConfig(turbo))

  const pnpmWorkspace = await readOptional(
    join(projectDir, PNPM_WORKSPACE),
    (text) => parseYaml(text),
    UnknownRecord,
    PNPM_WORKSPACE,
    reporter,
  )
  if (pnpmWorkspace !== null) findings.push(...auditPnpmWorkspace(pnpmWorkspace))

  const manifest = await readOptional(
    join(projectDir, PACKAGE_JSON),
    (text) => JSON.parse(text) as unknown,
    PackageManifestSchema,
    PACKAGE_JSON,
    reporter,
  )
  if (manifest !== null) {
    findings.push(...auditSecurityFloors(manifest))
    findings.push(...auditEngines(manifest))
  }

  const tsconfig = await readOptional(
    join(projectDir, TSCONFIG),
    parseConfigJson,
    TsconfigSchema,
    TSCONFIG,
    reporter,
  )
  if (tsconfig !== null) {
    const declared = { ...manifest?.dependencies, ...manifest?.devDependencies }
    const hasNextjs =
      declared.next !== undefined || (await pathExists(join(projectDir, 'next.config.ts')))
    findings.push(...auditTsconfig(tsconfig, hasNextjs))
  }

  return findings
}
