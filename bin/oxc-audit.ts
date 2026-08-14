#!/usr/bin/env node
import { realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command, CommanderError, InvalidArgumentError } from 'commander'
import pc from 'picocolors'
import { z } from 'zod'

import { findClosestPackageJson, readJsonFile } from '../src/fs-utils.js'
import { audit, auditWorkspace } from '../src/index.js'
import { DefaultReporter } from '../src/reporter.js'
import { AUDIT_DOMAINS, AUDIT_LEVELS } from '../src/types.js'
import type {
  AuditDomain,
  AuditLevel,
  AuditOptions,
  AuditReport,
  Recommendation,
  StackSignalId,
  WorkspaceAuditReport,
} from '../src/types.js'

interface Stream {
  write(chunk: string): boolean | undefined
}

interface CliRuntimeOptions {
  stdout?: Stream
  stderr?: Stream
  signal?: AbortSignal
}

interface ParsedCliOptions {
  /** Every level, domain and stack flag arrives here as an optional boolean. */
  [flag: string]: boolean | string | number | undefined
  config?: string
  dir?: string
  write?: boolean
  backup?: boolean
  maxFiles?: number
  maxDepth?: number
  recurse?: boolean
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

  let request
  try {
    request = {
      level: resolveLevel(options),
      domains: resolveDomains(options),
      maximal: options.dom === true,
      forcedSignals: resolveForcedSignals(options),
    }
  } catch (err) {
    stderr.write(`${pc.red('✖')} ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  const auditOptions: AuditOptions = {
    projectDir: options.dir,
    configPath: options.config,
    ...request,
    write: options.write ?? false,
    noBackup: options.backup === false,
    maxFiles: options.maxFiles,
    maxDepth: options.maxDepth,
    format: options.format === true,
    verbose: options.verbose ?? false,
    signal: runtimeOptions.signal,
  }

  try {
    if (options.recurse) {
      const workspace = await auditWorkspace(auditOptions, reporter)

      if (options.json) {
        stdout.write(`${JSON.stringify(workspace, null, 2)}\n`)
      } else {
        stdout.write(formatWorkspaceReport(workspace, options.write ?? false))
      }

      return workspace.success ? 0 : 1
    }

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
    .option('-r, --recurse', 'Also audit every package found beneath the directory')
    .option(
      '--max-depth <depth>',
      'Directory depth to search for workspace packages',
      parsePositiveInteger,
    )
    .option('--format', 'Also write an oxfmt formatter config beside the linter config')
    .option('--json', 'Print the audit report as JSON to stdout')
    .option('-v, --verbose', 'Show detailed progress information')

  for (const level of AUDIT_LEVELS) {
    command.option(`--${level}`, LEVEL_HELP[level])
  }

  for (const domain of AUDIT_DOMAINS) {
    command.option(`--${domain}`, `Enable the ${domain} rule set regardless of the level`)
  }

  for (const [flag, signals] of Object.entries(STACK_FLAGS)) {
    command.option(`--${flag}`, `Audit as if ${formatList(signals)} present`)
  }

  command.option(
    '--dom',
    'Every rule the detected stack could justify: the paranoid level with every domain on',
  )

  return command
}

/** `a`, `b and c` - so a three-signal flag does not read as "a and b and c". */
function formatList(items: readonly string[]): string {
  const last = items.at(-1)

  if (items.length <= 1) {
    return `${last ?? 'nothing'} were`
  }

  return `${items.slice(0, -1).join(', ')} and ${last} were`
}

/** Levels, in ladder order, with the one-line help each flag shows. */
const LEVEL_HELP: Record<AuditLevel, string> = {
  basic: 'Correctness only - the smallest config that still catches real bugs',
  recommended: 'Correctness and suspicious, plus the targeted rules (default)',
  strict: 'Also pedantic and perf, and the type-aware rules that reject working code',
  paranoid: 'Also restriction and style, and the whole-codebase policies',
}

/**
 * Stack flags, and the signals each asserts.
 *
 * A flag is a claim about the project, not a rule set: it joins the detected stack as
 * `flag` evidence and then travels the same path a detected signal would. `--next` implies
 * React because Next.js projects are React projects, and the rules gated on `react` would
 * otherwise be skipped on a forced Next.js audit.
 */
const STACK_FLAGS: Record<string, StackSignalId[]> = {
  typescript: ['typescript', 'tsconfig'],
  react: ['react', 'react-dom', 'jsx'],
  next: ['nextjs', 'react', 'react-dom', 'jsx'],
  vue: ['vue'],
  svelte: ['svelte'],
  astro: ['astro'],
  node: ['node'],
  vitest: ['vitest'],
  jest: ['jest'],
}

/**
 * Read the level off the parsed flags.
 *
 * Levels are mutually exclusive, so more than one is a mistake worth stopping for rather
 * than silently resolving - the two readings (highest wins, last wins) disagree, and
 * guessing would make the written config depend on argument order.
 */
function resolveLevel(options: ParsedCliOptions): AuditLevel {
  const chosen = AUDIT_LEVELS.filter((level) => options[level] === true)

  if (chosen.length > 1) {
    throw new InvalidArgumentError(
      `Levels are mutually exclusive; got ${chosen.map((level) => `--${level}`).join(' and ')}.`,
    )
  }

  return chosen[0] ?? 'recommended'
}

function resolveDomains(options: ParsedCliOptions): AuditDomain[] {
  return AUDIT_DOMAINS.filter((domain) => options[domain] === true)
}

function resolveForcedSignals(options: ParsedCliOptions): StackSignalId[] {
  const forced = new Set<StackSignalId>()

  for (const [flag, signals] of Object.entries(STACK_FLAGS)) {
    if (options[flag] === true) {
      for (const signal of signals) {
        forced.add(signal)
      }
    }
  }

  return [...forced]
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

  // A signal asserted with a flag and never found on disk is marked, so the report never
  // implies the project declares something it does not.
  const signals = report.stack.signals.map((signal) =>
    signal.evidence.every(({ kind }) => kind === 'flag') ? `${signal.id} (forced)` : signal.id,
  )
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

  if (report.configFindings.length > 0) {
    // Reported, never applied: these live outside the Oxlint config this tool writes, and
    // their fixes are codemods and version bumps rather than key edits.
    lines.push(pc.bold('Configuration findings (not applied)'))
    for (const found of report.configFindings) {
      const label =
        found.severity === 'error'
          ? pc.red(found.severity)
          : found.severity === 'warning'
            ? pc.yellow(found.severity)
            : pc.dim(found.severity)
      lines.push(
        `  ${label} ${pc.cyan(`${found.file}:${found.key}`)} - ${found.title}`,
        `      ${pc.dim(found.detail)}`,
      )
    }
    lines.push('')
  }

  if (report.format) {
    const { path, added, carriedFrom, written, existed } = report.format
    lines.push(pc.bold(written ? 'Formatter config written' : 'Formatter config'))
    lines.push(
      added.length > 0
        ? `  ${pc.cyan(path)} - ${added.length} setting(s): ${added.join(', ')}`
        : `  ${pc.cyan(path)} - nothing to add${existed ? '; every key is already set' : ''}`,
    )
    if (carriedFrom) {
      lines.push(`      ${pc.dim(`Settings carried across from the ${carriedFrom} config.`)}`)
    }
    lines.push('')
  }

  if (report.prerequisites.length > 0) {
    lines.push(pc.bold('Available with an extra install'))
    for (const prerequisite of report.prerequisites) {
      lines.push(
        `  ${pc.cyan(prerequisite.capability)}`,
        `      ${pc.dim(prerequisite.reason)}`,
        `      ${prerequisite.install}`,
      )
    }
    lines.push('')
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
      ? pc.green(`Nothing to add - ${satisfied} recommendation(s) already satisfied.`)
      : write && report.config.written
        ? pc.green(`Wrote ${report.recommendations.length} change(s) to ${report.config.path}`)
        : pc.dim(`Run with --write to apply these to ${report.config.path}`),
    '',
  )

  return lines.join('\n')
}

function formatWorkspaceReport(workspace: WorkspaceAuditReport, write: boolean): string {
  const sections = [pc.bold(pc.underline('Workspace root')), formatReport(workspace.root, write)]

  for (const { relativeDir, report } of workspace.packages) {
    const findings =
      report.configFindings.length > 0 ? `, ${report.configFindings.length} config finding(s)` : ''
    const counts = `${report.recommendations.length} to add, ${report.alreadySatisfied.length} satisfied${findings}`
    sections.push(pc.bold(pc.underline(relativeDir)), pc.dim(`  ${counts}`), '')

    // Only the actionable part is expanded per package; the full detail is in --json.
    if (report.recommendations.length > 0) {
      sections.push(...report.recommendations.map((entry) => `  ${formatTarget(entry)}`), '')
    }

    if (report.errors.length > 0 || report.blockers.length > 0) {
      sections.push(
        ...[...report.errors, ...report.blockers].map((message) => `  ${pc.red(message)}`),
        '',
      )
    }
  }

  if (workspace.packages.length === 0) {
    sections.push(pc.dim('No packages found beneath the root.'), '')
  }

  return sections.join('\n')
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
  // The path is the whole substance of a js-plugin entry, so it belongs in the line
  // rather than only in the written config.
  const specifier = recommendation.specifier ? pc.dim(` -> ${recommendation.specifier}`) : ''

  return `${pc.cyan(recommendation.kind)} ${recommendation.target}${severity}${specifier}`
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

/**
 * Whether this module is the process entrypoint rather than an import.
 *
 * Package managers install bins as symlinks (`node_modules/.bin/oxc-audit` ->
 * `../oxc-audit/dist/bin/oxc-audit.mjs`). Node resolves symlinks when it builds
 * `import.meta.url` but leaves `process.argv[1]` pointing at the link, so comparing the
 * two raw paths only ever matches when the file is run by its real path. Invoked through
 * the link - which is every `npx oxc-audit` and every `node_modules/.bin` call - the
 * comparison fails and the CLI exits silently having parsed nothing. Both sides are
 * resolved to their real paths before comparing.
 */
export async function isProcessEntrypoint(
  invokedPath: string | undefined,
  moduleUrl: string,
): Promise<boolean> {
  if (!invokedPath) {
    return false
  }

  const modulePath = fileURLToPath(moduleUrl)

  try {
    return (await realpath(invokedPath)) === (await realpath(modulePath))
  } catch {
    // argv[1] can name something that is not on disk (an eval'd or piped entry). It is
    // then not this module, but compare the raw paths rather than assume either way.
    return invokedPath === modulePath
  }
}

// Only self-execute as a binary; importing the module for tests must not run the CLI.
if (await isProcessEntrypoint(process.argv[1], import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', createTerminationHandler('SIGINT', controller, process.stderr))
  process.once('SIGTERM', createTerminationHandler('SIGTERM', controller, process.stderr))

  process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal })
}
