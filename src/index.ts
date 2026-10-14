import { readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import { auditConfigFiles } from './config-audit.js'
import { mergeRecommendations } from './config-merger.js'
import {
  findExistingFormatterConfig,
  findOxfmtConfig,
  loadOxfmtConfig,
  mergeFormatterConfig,
  OXFMT_CONFIG_NAMES,
} from './format-config-loader.js'
import type { LoadedOxfmtConfig } from './format-config-loader.js'
import { recommendFormatterConfig } from './format-recommender.js'
import { copyFileIfExists, pathExists, writeTextFileAtomically } from './fs-utils.js'
import {
  canResolveOxlint,
  containsComments,
  findOxlintConfig,
  findOxlintModuleConfig,
  isModuleConfigPath,
  isPlainModuleConfig,
  loadOxlintConfig,
  OXLINT_CONFIG_NAMES,
  OXLINT_TS_CONFIG_NAME,
  serializeOxlintConfig,
} from './oxlint-config-loader.js'
import { validateOxlintConfig } from './oxlint-config-validator.js'
import { updatePackageJson } from './package-updater.js'
import { acquireProjectLock, ProjectLockedError } from './project-lock.js'
import { CollectingReporter } from './reporter.js'
import { DEFAULT_REQUEST, findPrerequisites, recommendForStack } from './rule-recommender.js'
import { detectStack, hasSignal, withForcedSignals } from './stack-detector.js'
import type {
  AuditOptions,
  AuditRequest,
  FormatConfigReport,
  AuditReport,
  OxfmtConfig,
  ProjectStack,
  Reporter,
  WorkspaceAuditReport,
} from './types.js'
import { discoverWorkspace } from './workspace.js'

export async function audit(
  options: AuditOptions = {},
  reporter: Reporter = new CollectingReporter(),
): Promise<AuditReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())

  if (!(await pathExists(projectDir))) {
    reporter.error(`Project directory not found: ${projectDir}`)
    return buildErrorReport(reporter, projectDir)
  }

  const configPath = options.configPath
    ? resolve(projectDir, options.configPath)
    : ((await findOxlintConfig(projectDir)) ??
      resolve(
        projectDir,
        options.tsConfig ? OXLINT_TS_CONFIG_NAME : (OXLINT_CONFIG_NAMES[0] ?? ''),
      ))

  // Only writes need serializing; a read-only audit cannot interfere with anything.
  let lock: Awaited<ReturnType<typeof acquireProjectLock>> | undefined

  if (options.write) {
    try {
      lock = await acquireProjectLock(projectDir, reporter)
    } catch (err) {
      if (err instanceof ProjectLockedError) {
        reporter.error(err.message)
        return buildErrorReport(reporter, projectDir)
      }

      throw err
    }
  }

  try {
    return await runAudit(options, reporter, projectDir, configPath)
  } finally {
    await lock?.release()
  }
}

async function runAudit(
  options: AuditOptions,
  reporter: Reporter,
  projectDir: string,
  configPath: string,
): Promise<AuditReport> {
  options.signal?.throwIfAborted()

  const request: AuditRequest = {
    level: options.level ?? DEFAULT_REQUEST.level,
    domains: options.domains ?? DEFAULT_REQUEST.domains,
    maximal: options.maximal ?? DEFAULT_REQUEST.maximal,
    forcedSignals: options.forcedSignals ?? DEFAULT_REQUEST.forcedSignals,
  }

  const detected = await detectStack(projectDir, reporter, { maxFiles: options.maxFiles })
  // Flags join the stack as evidence rather than short-circuiting it, so everything
  // downstream keeps working off one uniform notion of what the project contains.
  const stack = withForcedSignals(detected, request.forcedSignals)

  if (stack.signals.length === 0) {
    reporter.warn(
      'No stack signals were detected. Without a package.json or recognisable source files there is nothing to base recommendations on.',
    )
  }

  options.signal?.throwIfAborted()

  let loaded
  try {
    loaded = await loadOxlintConfig(configPath)
  } catch (err) {
    reporter.error(err instanceof Error ? err.message : String(err))
    return buildErrorReport(reporter, projectDir, stack, configPath)
  }

  if (loaded.existed) {
    reporter.info(`Found Oxlint config: ${configPath}`)

    if (options.tsConfig && !isModuleConfigPath(configPath)) {
      reporter.warn(
        `--ts-config only chooses the format of a new config; the existing ${configPath} is kept and updated as JSON.`,
      )
    }
  } else {
    reporter.info(`No Oxlint config found; a new one would be created at ${configPath}`)
  }

  const configFindings = await auditConfigFiles(projectDir, reporter, {
    hasNextjs: hasSignal(stack, 'nextjs'),
  })

  options.signal?.throwIfAborted()

  const merge = mergeRecommendations(loaded.config, recommendForStack(stack, request))

  // Oxlint refuses to start when a directory holds both a module config and an
  // `.oxlintrc.json`, so writing one beside `oxlint.config.ts` would break linting outright.
  const moduleConfigPath = await findOxlintModuleConfig(projectDir)

  if (
    options.write &&
    moduleConfigPath !== undefined &&
    !loaded.existed &&
    !isModuleConfigPath(configPath)
  ) {
    reporter.blocker(
      `${moduleConfigPath} already configures Oxlint, and Oxlint allows only one config per directory. Writing ${configPath} would stop it running entirely. Apply these recommendations to ${moduleConfigPath} by hand.`,
    )
  }

  if (
    options.write &&
    !loaded.existed &&
    isModuleConfigPath(configPath) &&
    !canResolveOxlint(projectDir)
  ) {
    reporter.blocker(
      `${configPath} would import defineConfig from oxlint, which is not installed in this project, so Oxlint could not load it. Install oxlint first.`,
    )
  }

  // Rewriting drops comments, which is a real loss the user did not ask for.
  if (options.write && containsComments(loaded.originalText)) {
    reporter.blocker(
      `${configPath} contains comments, which would be lost when the file is rewritten. Apply the recommendations by hand, or strip the comments first.`,
    )
  } else if (
    options.write &&
    merge.changed &&
    loaded.originalText !== undefined &&
    isModuleConfigPath(configPath) &&
    !isPlainModuleConfig(configPath, loaded.originalText, loaded.config)
  ) {
    reporter.blocker(
      `${configPath} does more than export a plain config object - other imports, an extends, or computed values - and rewriting it would replace that code with the values it produced. Apply the recommendations by hand.`,
    )
  }

  for (const problem of validateOxlintConfig(merge.config)) {
    reporter.blocker(`Merged configuration would be invalid: ${problem}`)
  }

  // The formatter half is planned before anything is written, so a blocker on either half
  // is known before the first write and suppresses both. A run that cannot finish one half
  // must not half-finish the other.
  const formatPlan =
    options.format !== false
      ? await planFormatterConfig(projectDir, stack, reporter, options)
      : undefined

  const blocked = reporter.getBlockers().length > 0
  let written = false

  if (options.write && merge.changed && !blocked) {
    try {
      if (!options.noBackup && loaded.existed) {
        if (await copyFileIfExists(configPath, `${configPath}.backup`, options.signal)) {
          reporter.info(`Backed up existing config to ${configPath}.backup`)
        }
      }

      await writeTextFileAtomically(configPath, serializeOxlintConfig(configPath, merge.config), {
        ensureDirectory: true,
        signal: options.signal,
      })
      written = true
      reporter.info(`Applied ${merge.applied.length} recommendation(s) to ${configPath}`)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }

      reporter.error(
        `Failed to write ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else if (options.write && !merge.changed && !blocked) {
    reporter.info('Configuration already satisfies every recommendation; nothing to write.')
  }

  const format = formatPlan
    ? await writeFormatterConfig(formatPlan, reporter, options, blocked)
    : undefined

  const packageUpdate = options.noScripts
    ? undefined
    : await updatePackageJson(projectDir, reporter, {
        write: options.write === true && !blocked,
        typeAware: merge.config.options?.typeAware === true,
        format: options.format !== false,
        jsPlugins: (merge.config.jsPlugins ?? []).length > 0,
        packageManager: stack.packageManager,
        signal: options.signal,
      })

  return {
    success: reporter.getErrors().length === 0 && reporter.getBlockers().length === 0,
    warnings: reporter.getWarnings(),
    errors: reporter.getErrors(),
    blockers: reporter.getBlockers(),
    stack,
    recommendations: merge.applied,
    alreadySatisfied: merge.alreadySatisfied,
    configFindings,
    prerequisites: findPrerequisites(stack, request, { format: options.format !== false }),
    explicitlyDisabled: merge.explicitlyDisabled,
    config: {
      path: configPath,
      existed: loaded.existed,
      written,
      changed: merge.changed,
    },
    format,
    packageUpdate,
  }
}

/** The formatter half of a run, worked out before any file is touched. */
interface FormatterPlan {
  path: string
  /** Undefined when the existing file could not be read; the error is already reported. */
  loaded: LoadedOxfmtConfig | undefined
  config: OxfmtConfig
  added: string[]
  carriedFrom: 'prettier' | 'biome' | undefined
}

/**
 * Plan the formatter half of the toolchain config: what exists, what would be added, and
 * whether writing it is possible at all.
 *
 * Kept separate from the linter plan on purpose, so a formatter config that cannot be read
 * does not stop the linter recommendations from being reported, and vice versa. The one
 * thing shared is the blocker list: a comment in this file is raised here, before either
 * half is written, so the linter write sees it too.
 */
async function planFormatterConfig(
  projectDir: string,
  stack: ProjectStack,
  reporter: Reporter,
  options: AuditOptions,
): Promise<FormatterPlan> {
  const configPath =
    (await findOxfmtConfig(projectDir)) ?? resolve(projectDir, OXFMT_CONFIG_NAMES[0] ?? '')

  let loaded
  try {
    loaded = await loadOxfmtConfig(configPath)
  } catch (err) {
    reporter.error(err instanceof Error ? err.message : String(err))
    return { path: configPath, loaded: undefined, config: {}, added: [], carriedFrom: undefined }
  }

  const existingFormatter = loaded.existed
    ? undefined
    : await findExistingFormatterConfig(projectDir, reporter)

  if (existingFormatter) {
    reporter.info(
      `Carrying ${Object.keys(existingFormatter.settings).length} formatter setting(s) across from the ${existingFormatter.source} config.`,
    )
  }

  // Prettier formats these file types too; Biome never did.
  if (existingFormatter?.source === 'biome') {
    reporter.warn(
      'oxfmt also formats Markdown, YAML, TOML and HTML, which Biome left alone, so the first `oxfmt --write` reformats any such files. Add them to ignorePatterns in the oxfmt config if that is not wanted.',
    )
  }

  const { config, added } = mergeFormatterConfig(
    loaded.config,
    recommendFormatterConfig(stack, existingFormatter),
  )

  // Rewriting drops comments. Raised only when there is something to write: a commented
  // config that already carries every setting is left alone and blocks nothing.
  if (options.write && added.length > 0 && containsComments(loaded.originalText)) {
    reporter.blocker(
      `${configPath} contains comments, which would be lost when the file is rewritten. Apply the formatter settings by hand, or strip the comments first.`,
    )
  }

  return { path: configPath, loaded, config, added, carriedFrom: existingFormatter?.source }
}

async function writeFormatterConfig(
  plan: FormatterPlan,
  reporter: Reporter,
  options: AuditOptions,
  blocked: boolean,
): Promise<FormatConfigReport> {
  const { path: configPath, loaded, config, added, carriedFrom } = plan
  let written = false

  if (loaded && options.write && added.length > 0 && !blocked) {
    try {
      if (!options.noBackup && loaded.existed) {
        await copyFileIfExists(configPath, `${configPath}.backup`, options.signal)
      }

      await writeTextFileAtomically(configPath, `${JSON.stringify(config, null, 2)}\n`, {
        ensureDirectory: true,
        signal: options.signal,
      })
      written = true
      reporter.info(`Wrote ${added.length} formatter setting(s) to ${configPath}`)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }

      reporter.error(
        `Failed to write ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { path: configPath, existed: loaded?.existed ?? false, written, added, carriedFrom }
}

/**
 * Audits a workspace root and every package beneath it.
 *
 * Dependency signals come from a single manifest, so auditing only the root of a
 * workspace under-reports: the frameworks live in the leaf packages. This audits each
 * package against its own nearest config, which is also how Oxlint resolves configs -
 * a child config is used on its own rather than merged into the parent's.
 *
 * Packages are audited in sequence, not in parallel: each write takes a lock on its own
 * directory, and serialising keeps the output readable and the failure mode obvious.
 */
export async function auditWorkspace(
  options: AuditOptions = {},
  reporter: Reporter = new CollectingReporter(),
): Promise<WorkspaceAuditReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const root = await audit(options, reporter)
  const discovery = await discoverWorkspace(projectDir, { maxDepth: options.maxDepth })
  const discovered = discovery.packages

  reporter.info(
    discovered.length > 0
      ? `Found ${discovered.length} package(s) beneath ${projectDir}`
      : `No packages found beneath ${projectDir}`,
  )

  // Skipping is correct, but never silent: an exclusion the user forgot about would
  // otherwise look identical to a package the tool failed to find.
  if (discovery.excluded.length > 0) {
    reporter.info(
      `Skipped ${discovery.excluded.length} package(s) excluded by ${discovery.declaredIn}: ${discovery.excluded
        .map((entry) => entry.relativeDir)
        .join(', ')}`,
    )
  }

  const packages: WorkspaceAuditReport['packages'] = []

  for (const workspacePackage of discovered) {
    options.signal?.throwIfAborted()

    // Each package gets its own reporter so one package's warnings are not attributed
    // to another in the combined output.
    const packageReport = await audit(
      { ...options, projectDir: workspacePackage.dir, configPath: undefined },
      new CollectingReporter(),
    )

    packages.push({ relativeDir: workspacePackage.relativeDir, report: packageReport })
  }

  return {
    success: root.success && packages.every(({ report }) => report.success),
    root,
    packages,
  }
}

/**
 * Restores a config from its `.backup` sibling, for undoing an applied audit.
 */
export async function restoreConfigBackup(
  configPath: string,
  reporter: Reporter,
): Promise<boolean> {
  const backupPath = `${configPath}.backup`

  if (!(await pathExists(backupPath))) {
    reporter.error(`No backup found at ${backupPath}`)
    return false
  }

  await writeTextFileAtomically(configPath, await readFile(backupPath, 'utf-8'), {
    ensureDirectory: true,
  })
  await unlink(backupPath)
  reporter.info(`Restored ${configPath} from backup`)

  return true
}

function buildErrorReport(
  reporter: Reporter,
  projectDir: string,
  stack?: ProjectStack,
  configPath = '',
): AuditReport {
  return {
    success: false,
    warnings: reporter.getWarnings(),
    errors: reporter.getErrors(),
    blockers: reporter.getBlockers(),
    stack: stack ?? {
      projectDir,
      packageJsonPath: undefined,
      signals: [],
      sourceExtensions: [],
      filesScanned: 0,
      scanTruncated: false,
      generatedFiles: [],
    },
    recommendations: [],
    alreadySatisfied: [],
    configFindings: [],
    prerequisites: [],
    explicitlyDisabled: [],
    config: { path: configPath, existed: false, written: false, changed: false },
  }
}

export { auditConfigFiles } from './config-audit.js'
export { mergeRecommendations, OXLINT_DEFAULT_PLUGINS } from './config-merger.js'
export { detectStack, hasSignal } from './stack-detector.js'
export {
  findPrerequisites,
  getRecommendablePlugins,
  getRecommendableRuleNames,
  getTypeAwareRuleNames,
  recommendForStack,
} from './rule-recommender.js'
export { CollectingReporter, DefaultReporter } from './reporter.js'
export { discoverWorkspace, findWorkspacePackages } from './workspace.js'
export { matchesGlob, readWorkspaceDeclaration } from './workspace-globs.js'
export * from './types.js'
export { compareVersions, minimumVersionOf } from './versions.js'
