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

/** How a signal was established. Every signal is a fact read off disk, never a guess. */
export type EvidenceKind =
  | 'dependency'
  | 'dev-dependency'
  | 'peer-dependency'
  | 'config-file'
  | 'source-extension'
  | 'tsconfig-field'

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
  kind: 'plugin' | 'category' | 'rule' | 'option'
  /** Plugin name, category name, rule name, or `options` key. */
  target: string
  /** Severity for category/rule recommendations. */
  severity?: OxlintSeverity
  /** Why this is recommended, phrased for a human reading the report. */
  reason: string
  /** The signals that triggered it. */
  triggeredBy: StackSignalId[]
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
