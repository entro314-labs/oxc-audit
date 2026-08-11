import pc from 'picocolors'

import type { Reporter } from './types.js'

interface ReporterStream {
  write(chunk: string): boolean | undefined
}

interface ReporterOptions {
  verbose?: boolean
  stdout?: ReporterStream
  stderr?: ReporterStream
}

export class CollectingReporter implements Reporter {
  protected readonly warnings: string[] = []
  protected readonly errors: string[] = []
  protected readonly blockers: string[] = []

  warn(message: string): void {
    this.warnings.push(message)
  }

  error(message: string): void {
    this.errors.push(message)
  }

  blocker(message: string): void {
    this.blockers.push(message)
    this.warn(message)
  }

  info(_message: string): void {}

  getWarnings(): string[] {
    return [...this.warnings]
  }

  getErrors(): string[] {
    return [...this.errors]
  }

  getBlockers(): string[] {
    return [...this.blockers]
  }
}

export class DefaultReporter extends CollectingReporter {
  private readonly verbose: boolean
  private readonly stdout: ReporterStream
  private readonly stderr: ReporterStream

  constructor(options: ReporterOptions = {}) {
    super()
    this.verbose = options.verbose ?? false
    this.stdout = options.stdout ?? process.stdout
    this.stderr = options.stderr ?? process.stderr
  }

  override warn(message: string): void {
    super.warn(message)
    this.stderr.write(`${pc.yellow('⚠')} ${message}\n`)
  }

  override blocker(message: string): void {
    this.blockers.push(message)
    super.warn(message)
    this.stderr.write(`${pc.magenta('⊘')} ${message}\n`)
  }

  override error(message: string): void {
    super.error(message)
    this.stderr.write(`${pc.red('✖')} ${message}\n`)
  }

  override info(message: string): void {
    if (!this.verbose) {
      return
    }

    this.stdout.write(`${message}\n`)
  }
}
