import { readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import { mergeRecommendations } from './config-merger.js'
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
import { recommendForStack } from './rule-recommender.js'
import { detectStack } from './stack-detector.js'
import type { AuditOptions, AuditReport, ProjectStack, Reporter } from './types.js'

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

  const stack = await detectStack(projectDir, reporter, { maxFiles: options.maxFiles })

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

  const merge = mergeRecommendations(loaded.config, recommendForStack(stack))

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

  return {
    success: reporter.getErrors().length === 0 && reporter.getBlockers().length === 0,
    warnings: reporter.getWarnings(),
    errors: reporter.getErrors(),
    blockers: reporter.getBlockers(),
    stack,
    recommendations: merge.applied,
    alreadySatisfied: merge.alreadySatisfied,
    explicitlyDisabled: merge.explicitlyDisabled,
    config: {
      path: configPath,
      existed: loaded.existed,
      written,
      changed: merge.changed,
    },
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
    explicitlyDisabled: [],
    config: { path: configPath, existed: false, written: false, changed: false },
  }
}

export { mergeRecommendations, OXLINT_DEFAULT_PLUGINS } from './config-merger.js'
export { detectStack, hasSignal } from './stack-detector.js'
export {
  getRecommendablePlugins,
  getRecommendableRuleNames,
  recommendForStack,
} from './rule-recommender.js'
export { CollectingReporter, DefaultReporter } from './reporter.js'
export * from './types.js'
