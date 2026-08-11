#!/usr/bin/env node
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command, CommanderError, InvalidArgumentError } from 'commander'
import pc from 'picocolors'
import { z } from 'zod'

import { findClosestPackageJson, readJsonFile } from '../src/fs-utils.js'
import { audit } from '../src/index.js'
import { DefaultReporter } from '../src/reporter.js'
import type { AuditOptions, AuditReport, Recommendation } from '../src/types.js'

interface Stream {
  write(chunk: string): boolean | undefined
}

interface CliRuntimeOptions {
  stdout?: Stream
  stderr?: Stream
  signal?: AbortSignal
}

interface ParsedCliOptions {
  config?: string
  dir?: string
  write?: boolean
  backup?: boolean
  maxFiles?: number
  json?: boolean
  verbose?: boolean
}

const CliPackageMetadataSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
})

export async function runCli(
  argv: string[],
  runtimeOptions: CliRuntimeOptions = {},
): Promise<number> {
  const stdout = runtimeOptions.stdout ?? process.stdout
  const stderr = runtimeOptions.stderr ?? process.stderr

  let metadata
  try {
    metadata = await loadCliPackageMetadata()
  } catch (err) {
    stderr.write(`${pc.red('✖')} ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  const command = buildCommand(metadata, { stdout, stderr })

  try {
    command.parse(argv, { from: 'user' })
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode
    }

    throw err
  }

  const options = command.opts<ParsedCliOptions>()
  const reporter = new DefaultReporter({
    verbose: (options.verbose ?? false) && !options.json,
    stdout,
    stderr,
  })

  const auditOptions: AuditOptions = {
    projectDir: options.dir,
    configPath: options.config,
    write: options.write ?? false,
    noBackup: options.backup === false,
    maxFiles: options.maxFiles,
    verbose: options.verbose ?? false,
    signal: runtimeOptions.signal,
  }

  try {
    const report = await audit(auditOptions, reporter)

    if (options.json) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      stdout.write(formatReport(report, options.write ?? false))
    }

    return report.success ? 0 : 1
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      stderr.write(`${pc.yellow('⚠')} Audit cancelled.\n`)
      return 130
    }

    stderr.write(`${pc.red('✖')} ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

function buildCommand(
  metadata: z.infer<typeof CliPackageMetadataSchema>,
  streams: { stdout: Stream; stderr: Stream },
): Command {
  const command = new Command()

  command
    .name(metadata.name)
    .description(metadata.description)
    .version(metadata.version)
    .helpOption('-h, --help', 'display help for command')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({
      writeErr: (chunk) => {
        streams.stderr.write(chunk)
      },
      writeOut: (chunk) => {
        streams.stdout.write(chunk)
      },
    })
    .option('-d, --dir <path>', 'Project directory to audit (default: current directory)')
    .option('-c, --config <path>', 'Path to the Oxlint config (default: .oxlintrc.json)')
    .option('-w, --write', 'Apply the recommendations. Without this the audit only reports.')
    .option('--no-backup', 'Skip writing a .backup copy before applying changes')
    .option(
      '--max-files <count>',
      'Maximum source files to scan before truncating',
      parsePositiveInteger,
    )
    .option('--json', 'Print the audit report as JSON to stdout')
    .option('-v, --verbose', 'Show detailed progress information')

  return command
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer.')
  }

  return parsed
}

function formatReport(report: AuditReport, write: boolean): string {
  const lines: string[] = ['']

  const signals = report.stack.signals.map((signal) => signal.id)
  lines.push(
    pc.bold('Stack'),
    signals.length > 0 ? `  ${signals.join(', ')}` : '  nothing detected',
    `  ${report.stack.filesScanned} files scanned${report.stack.scanTruncated ? ' (truncated)' : ''}`,
    '',
  )

  if (report.recommendations.length > 0) {
    lines.push(pc.bold(write ? 'Applied' : 'Recommended'))
    lines.push(...report.recommendations.map((entry) => `  ${formatRecommendation(entry)}`))
    lines.push('')
  }

  if (report.explicitlyDisabled.length > 0) {
    lines.push(pc.bold('Explicitly disabled in your config (left untouched)'))
    lines.push(...report.explicitlyDisabled.map((entry) => `  ${pc.dim(formatTarget(entry))}`), '')
  }

  if (report.blockers.length > 0) {
    lines.push(pc.bold(pc.magenta('Blocked')))
    lines.push(...report.blockers.map((blocker) => `  ${blocker}`), '')
  }

  if (report.errors.length > 0) {
    lines.push(pc.bold(pc.red('Errors')))
    lines.push(...report.errors.map((error) => `  ${error}`), '')
  }

  const satisfied = report.alreadySatisfied.length
  lines.push(
    report.recommendations.length === 0
      ? pc.green(`Nothing to add — ${satisfied} recommendation(s) already satisfied.`)
      : write && report.config.written
        ? pc.green(`Wrote ${report.recommendations.length} change(s) to ${report.config.path}`)
        : pc.dim(`Run with --write to apply these to ${report.config.path}`),
    '',
  )

  return lines.join('\n')
}

function formatRecommendation(recommendation: Recommendation): string {
  const trigger =
    recommendation.triggeredBy.length > 0
      ? pc.dim(` [${recommendation.triggeredBy.join(', ')}]`)
      : ''

  return `${formatTarget(recommendation)}${trigger}\n      ${pc.dim(recommendation.reason)}`
}

function formatTarget(recommendation: Recommendation): string {
  const severity = recommendation.severity ? `: ${recommendation.severity}` : ''

  return `${pc.cyan(recommendation.kind)} ${recommendation.target}${severity}`
}

async function loadCliPackageMetadata(): Promise<z.infer<typeof CliPackageMetadataSchema>> {
  const packageDirectory = dirname(fileURLToPath(import.meta.url))
  const manifestPath = await findClosestPackageJson(packageDirectory)

  if (!manifestPath) {
    throw new Error('Unable to locate the CLI package manifest.')
  }

  return readJsonFile(manifestPath, CliPackageMetadataSchema, `CLI manifest at ${manifestPath}`)
}

export function createTerminationHandler(
  signalName: string,
  controller: AbortController,
  stderr: Stream,
): () => void {
  return () => {
    if (controller.signal.aborted) {
      return
    }

    stderr.write(`\n${pc.yellow('⚠')} Received ${signalName}, cancelling…\n`)
    controller.abort()
  }
}

// Only self-execute as a binary; importing the module for tests must not run the CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const controller = new AbortController()
  process.once('SIGINT', createTerminationHandler('SIGINT', controller, process.stderr))
  process.once('SIGTERM', createTerminationHandler('SIGTERM', controller, process.stderr))

  process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal })
}
