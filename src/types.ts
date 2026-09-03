export type OxlintBuiltinPlugin =
  | 'eslint'
  | 'react'
  | 'unicorn'
  | 'typescript'
  | 'oxc'
  | 'import'
  | 'jsdoc'
  | 'jest'
  | 'vitest'
  | 'jsx-a11y'
  | 'nextjs'
  | 'react-perf'
  | 'promise'
  | 'node'
  | 'vue'

export type OxlintCategory =
  | 'correctness'
  | 'nursery'
  | 'pedantic'
  | 'perf'
  | 'restriction'
  | 'style'
  | 'suspicious'

export type OxlintSeverity = 'off' | 'warn' | 'error'

export type OxlintRuleSeverity = OxlintSeverity | [OxlintSeverity, ...unknown[]]

export type OxlintJsPlugin = string | { name: string; specifier: string }

export interface OxlintSettings {
  jsdoc?: Record<string, unknown>
  'jsx-a11y'?: Record<string, unknown>
  next?: { rootDir?: string | string[] }
  react?: Record<string, unknown>
  vitest?: { typecheck?: boolean }
  [key: string]: unknown
}

export interface OxlintOverride {
  files: string[]
  excludeFiles?: string[]
  env?: Record<string, boolean>
  globals?: Record<string, boolean | 'readonly' | 'writable' | 'off'>
  plugins?: OxlintBuiltinPlugin[]
  jsPlugins?: OxlintJsPlugin[]
  rules?: Record<string, OxlintRuleSeverity>
}

export interface OxlintConfig {
  $schema?: string
  options?: { typeAware?: boolean; typeCheck?: boolean }
  env?: Record<string, boolean>
  globals?: Record<string, boolean | 'readonly' | 'writable' | 'off'>
  plugins?: OxlintBuiltinPlugin[]
  jsPlugins?: OxlintJsPlugin[]
  categories?: Partial<Record<OxlintCategory, OxlintSeverity>>
  rules?: Record<string, OxlintRuleSeverity>
  overrides?: OxlintOverride[]
  ignorePatterns?: string[]
  settings?: OxlintSettings
}

/**
 * An oxfmt configuration.
 *
 * Deliberately open: oxfmt's surface is 88 options across seven groups, this tool writes a
 * handful, and every other key in an existing file has to survive a merge untouched.
 * `docs/oxfmt-rules.tsv` is the tracked inventory the written keys are checked against.
 */
export type OxfmtConfig = Record<string, unknown>

/**
 * How a signal was established. Every signal is a fact - read off disk, or stated by the
 * user on the command line. Nothing is ever inferred.
 */
export type EvidenceKind =
  | 'dependency'
  | 'dev-dependency'
  | 'peer-dependency'
  | 'config-file'
  | 'source-extension'
  | 'tsconfig-field'
  /** Asserted by a `--react`-style flag. The user overrides detection; the run stays deterministic. */
  | 'flag'

/**
 * How much the audit asks for, as a ladder. Each level is a superset of the one below.
 *
 * The levels map onto Oxlint's own categories, so they mean the same thing here as they do
 * in a hand-written config: `basic` is correctness alone, and `paranoid` reaches into the
 * opinionated categories most projects leave off.
 */
export type AuditLevel = 'basic' | 'recommended' | 'strict' | 'paranoid'

/** Cross-cutting rule sets that ignore the level ladder when explicitly asked for. */
export type AuditDomain = 'security' | 'performance' | 'accessibility'

export const AUDIT_LEVELS: readonly AuditLevel[] = [
  'basic',
  'recommended',
  'strict',
  'paranoid',
] as const

export const AUDIT_DOMAINS: readonly AuditDomain[] = [
  'security',
  'performance',
  'accessibility',
] as const

/** What the user asked for, independent of what the project turned out to contain. */
export interface AuditRequest {
  level: AuditLevel
  domains: AuditDomain[]
  /**
   * `--dom`: every rule the detected stack could justify. Raises the level to `paranoid`
   * and turns on every domain, but changes nothing about evidence - a rule with no signal
   * behind it is still never recommended.
   */
  maximal: boolean
  /** Signals asserted on the command line, merged into the detected stack as `flag` evidence. */
  forcedSignals: StackSignalId[]
}

export interface Evidence {
  kind: EvidenceKind
  /** The dependency name, file name, or extension that produced the signal. */
  value: string
}

/** A capability detected in the project, with the evidence that established it. */
export interface StackSignal {
  id: StackSignalId
  evidence: Evidence[]
}

export type StackSignalId =
  | 'typescript'
  | 'tsconfig'
  | 'tsgolint'
  | 'jsx'
  | 'react'
  | 'react-dom'
  | 'nextjs'
  | 'vue'
  | 'svelte'
  | 'astro'
  | 'vitest'
  | 'jest'
  | 'node'
  | 'jsdoc'
  | 'esm'
  | 'monorepo'
  // Stacks the @entro314labs/oxlint-audit-plugins plugins cover. Detected separately from the plugins
  // themselves so the tool can say which plugins would apply before any are installed.
  | 'zod'
  | 'tanstack-query'
  | 'zustand'
  | 'react-hook-form'
  | 'drizzle'
  | 'ai-sdk'
  | 'stripe'
  | 'supabase'
  | 'vite'
  /** The audit plugin sources, as a dependency or a copy under `tools/`. */
  | 'audit-plugins'
  /** `@oxlint/plugins`, the runtime every js plugin imports. Without it none of them load. */
  | 'oxlint-plugins'

export interface ProjectStack {
  projectDir: string
  packageJsonPath: string | undefined
  signals: StackSignal[]
  /** File extensions actually present in the scanned source tree. */
  sourceExtensions: string[]
  /** Files scanned; reported so a suspiciously small number is visible, not silent. */
  filesScanned: number
  /** True when the scan stopped at the file budget rather than exhausting the tree. */
  scanTruncated: boolean
}

/** A single recommended change to the Oxlint config, with its justification. */
export interface Recommendation {
  kind: 'plugin' | 'js-plugin' | 'category' | 'rule' | 'option'
  /** Plugin name, category name, rule name, or `options` key. */
  target: string
  /** Severity for category/rule recommendations. */
  severity?: OxlintSeverity
  /**
   * Module path for `js-plugin` recommendations. Resolved from where the plugin package
   * was actually found, so the written config points at a file that exists.
   */
  specifier?: string
  /** Why this is recommended, phrased for a human reading the report. */
  reason: string
  /** The signals that triggered it. */
  triggeredBy: StackSignalId[]
}

/** How much a configuration finding matters. */
export type ConfigFindingSeverity = 'error' | 'warning' | 'info'

/**
 * A finding in a project configuration file.
 *
 * Distinct from a {@link Recommendation}: a recommendation changes the Oxlint config, while
 * a finding reports something wrong in a file Oxlint cannot read at all. Findings are never
 * applied automatically - the fix is usually a codemod or a version bump, not a key edit.
 */
export interface ConfigFinding {
  severity: ConfigFindingSeverity
  /** Project-relative file the finding is in, e.g. `turbo.json`. */
  file: string
  /** Dotted path to the offending key, e.g. `tasks.build.outputs`. */
  key: string
  /** Short label, suitable for a summary line. */
  title: string
  /** What is wrong and what to do about it. */
  detail: string
}

export interface AuditReport {
  /** True when the audit completed without errors. */
  success: boolean
  warnings: string[]
  errors: string[]
  /** Conditions that stopped the config from being written. */
  blockers: string[]
  stack: ProjectStack
  /** Recommendations the existing config does not already satisfy. */
  recommendations: Recommendation[]
  /** Recommendations already satisfied by the existing config. */
  alreadySatisfied: Recommendation[]
  /**
   * Problems found in project configuration files. Reported only - these are outside the
   * Oxlint config this tool writes, and their fixes are codemods and version bumps.
   */
  configFindings: ConfigFinding[]
  /**
   * Capabilities the project could adopt but has not installed the tooling for. Reported
   * rather than configured, because writing config for a missing engine would produce a
   * config the project cannot run.
   */
  prerequisites: Prerequisite[]
  /**
   * Recommendations the existing config explicitly turns off. Treated as a deliberate
   * decision and never re-applied, but surfaced so the opt-out stays visible.
   */
  explicitlyDisabled: Recommendation[]
  config: {
    path: string
    existed: boolean
    /** True when the file was written (false in dry-run or when nothing changed). */
    written: boolean
    changed: boolean
  }
  /** The formatter half of the run. Absent when `--no-format` turned it off. */
  format?: FormatConfigReport
  /** Scripts added and dependencies still missing. Absent when there is no manifest. */
  packageUpdate?: PackageUpdate
}

/** Scripts and dependencies the project needs to run what was configured. */
export interface PackageUpdate {
  path: string
  /** Script names added by this run. An existing script of the same name is left alone. */
  scriptsAdded: string[]
  written: boolean
  /** Tools the config needs that the manifest does not declare. Reported, never installed. */
  missingDependencies: string[]
  /** The install command for the project's own package manager. */
  installCommand: string | undefined
}

/** What happened to the formatter config, when `--format` asked for one. */
export interface FormatConfigReport {
  path: string
  existed: boolean
  /** True when the file was written (false in dry-run or when nothing was missing). */
  written: boolean
  /** Keys added by this run. Existing keys are decisions and are never overwritten. */
  added: string[]
  /** The tool whose settings were carried across, when one was found. */
  carriedFrom: 'prettier' | 'biome' | undefined
}

export interface Prerequisite {
  /** What becomes available once the prerequisite is met. */
  capability: string
  /** Why it is worth having. */
  reason: string
  /** The command that satisfies it. */
  install: string
}

export interface WorkspaceAuditReport {
  /** True when every audited package succeeded. */
  success: boolean
  /** The workspace root, audited in its own right. */
  root: AuditReport
  /** One report per package found beneath the root. */
  packages: Array<{ relativeDir: string; report: AuditReport }>
}

export interface AuditOptions {
  /** Directory to audit. Defaults to the current working directory. */
  projectDir?: string
  /** Explicit path to the Oxlint config. Defaults to `.oxlintrc.json` in the project. */
  configPath?: string
  /** Apply the recommendations. Without this the audit only reports. */
  write?: boolean
  /** Skip writing a `.backup` copy of an existing config. */
  noBackup?: boolean
  /** Maximum source files to scan before truncating. */
  maxFiles?: number
  /** Directory depth to search for workspace packages. */
  maxDepth?: number
  /** How much to ask for. Defaults to `recommended`. */
  level?: AuditLevel
  /** Cross-cutting rule sets to enable regardless of the level. */
  domains?: AuditDomain[]
  /** `--dom`: every rule the detected stack could justify. */
  maximal?: boolean
  /** Signals to assert regardless of what the project declares. */
  forcedSignals?: StackSignalId[]
  /** Also write a formatter config beside the linter config. Defaults to true. */
  format?: boolean
  /** Skip adding lint and format scripts to package.json. */
  noScripts?: boolean
  verbose?: boolean
  signal?: AbortSignal
}

export interface Reporter {
  warn(message: string): void
  error(message: string): void
  info(message: string): void
  /**
   * Records a condition that prevents the config from being written safely. Blockers
   * make the audit report `success: false` and suppress the write.
   */
  blocker(message: string): void
  getWarnings(): string[]
  getErrors(): string[]
  getBlockers(): string[]
}
