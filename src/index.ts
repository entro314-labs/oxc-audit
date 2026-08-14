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
import { recommendFormatterConfig } from './format-recommender.js'
import { copyFileIfExists, pathExists, writeTextFileAtomically } from './fs-utils.js'
import {
  containsComments,
  findOxlintConfig,
  loadOxlintConfig,
  OXLINT_CONFIG_NAMES,
} from './oxlint-config-loader.js'
import { validateOxlintConfig } from './oxlint-config-validator.js'
import { acquireProjectLock, ProjectLockedError } from './project-lock.js'
import { CollectingReporter } from './reporter.js'
import { DEFAULT_REQUEST, findPrerequisites, recommendForStack } from './rule-recommender.js'
import { detectStack, withForcedSignals } from './stack-detector.js'
import type {
  AuditOptions,
  AuditRequest,
  FormatConfigReport,
  AuditReport,
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
    : ((await findOxlintConfig(projectDir)) ?? resolve(projectDir, OXLINT_CONFIG_NAMES[0] ?? ''))

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
  } else {
    reporter.info(`No Oxlint config found; a new one would be created at ${configPath}`)
  }

  const configFindings = await auditConfigFiles(projectDir, reporter)

  options.signal?.throwIfAborted()

  const merge = mergeRecommendations(loaded.config, recommendForStack(stack, request))

  // Rewriting drops comments, which is a real loss the user did not ask for.
  if (options.write && containsComments(loaded.originalText)) {
    reporter.blocker(
      `${configPath} contains comments, which would be lost when the file is rewritten. Apply the recommendations by hand, or strip the comments first.`,
    )
  }

  for (const problem of validateOxlintConfig(merge.config)) {
    reporter.blocker(`Merged configuration would be invalid: ${problem}`)
  }

  const blocked = reporter.getBlockers().length > 0
  let written = false

  if (options.write && merge.changed && !blocked) {
    try {
      if (!options.noBackup && loaded.existed) {
        if (await copyFileIfExists(configPath, `${configPath}.backup`, options.signal)) {
          reporter.info(`Backed up existing config to ${configPath}.backup`)
        }
      }

      await writeTextFileAtomically(configPath, `${JSON.stringify(merge.config, null, 2)}\n`, {
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

  const format = options.format
    ? await applyFormatterConfig(projectDir, stack, reporter, options, blocked)
    : undefined

  return {
    success: reporter.getErrors().length === 0 && reporter.getBlockers().length === 0,
    warnings: reporter.getWarnings(),
    errors: reporter.getErrors(),
    blockers: reporter.getBlockers(),
    stack,
    recommendations: merge.applied,
    alreadySatisfied: merge.alreadySatisfied,
    configFindings,
    prerequisites: findPrerequisites(stack),
    explicitlyDisabled: merge.explicitlyDisabled,
    config: {
      path: configPath,
      existed: loaded.existed,
      written,
      changed: merge.changed,
    },
    format,
  }
}

/**
 * Write the formatter half of the toolchain config.
 *
 * Kept separate from the linter path on purpose: a formatter config that cannot be written
 * must not stop the linter recommendations from being applied, and vice versa. Blockers
 * raised against the Oxlint config suppress this too, because a run that could not finish
 * one half should not half-finish the other.
 */
async function applyFormatterConfig(
  projectDir: string,
  stack: ProjectStack,
  reporter: Reporter,
  options: AuditOptions,
  blocked: boolean,
): Promise<FormatConfigReport> {
  const configPath =
    (await findOxfmtConfig(projectDir)) ?? resolve(projectDir, OXFMT_CONFIG_NAMES[0] ?? '')

  let loaded
  try {
    loaded = await loadOxfmtConfig(configPath)
  } catch (err) {
    reporter.error(err instanceof Error ? err.message : String(err))
    return { path: configPath, existed: false, written: false, added: [], carriedFrom: undefined }
  }

  const existingFormatter = loaded.existed
    ? undefined
    : await findExistingFormatterConfig(projectDir, reporter)

  if (existingFormatter) {
    reporter.info(
      `Carrying ${Object.keys(existingFormatter.settings).length} formatter setting(s) across from the ${existingFormatter.source} config.`,
    )
  }

  const { config, added } = mergeFormatterConfig(
    loaded.config,
    recommendFormatterConfig(stack, existingFormatter),
  )

  let written = false

  if (options.write && added.length > 0 && !blocked) {
    if (containsComments(loaded.originalText)) {
      reporter.blocker(
        `${configPath} contains comments, which would be lost when the file is rewritten. Apply the formatter settings by hand, or strip the comments first.`,
      )
    } else {
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
  }

  return {
    path: configPath,
    existed: loaded.existed,
    written,
    added,
    carriedFrom: existingFormatter?.source,
  }
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
    },
    recommendations: [],
    alreadySatisfied: [],
    configFindings: [],
    prerequisites: [],
    explicitlyDisabled: [],
    config: { path: configPath, existed: false, written: false, changed: false },
  }
}

export { auditConfigFiles, compareVersions, minimumVersionOf } from './config-audit.js'
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
