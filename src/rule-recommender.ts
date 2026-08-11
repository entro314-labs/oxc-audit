import { hasSignal } from './stack-detector.js'
import type {
  OxlintBuiltinPlugin,
  OxlintCategory,
  OxlintSeverity,
  Prerequisite,
  ProjectStack,
  Recommendation,
  StackSignalId,
} from './types.js'

/**
 * A plugin is recommended only when the project carries evidence it is relevant.
 *
 * `requires` is an OR: any one signal is enough. Plugins with no matching signal are
 * never recommended, so the output stays proportional to what the project actually uses.
 */
const PLUGIN_RULES: Array<{
  plugin: OxlintBuiltinPlugin
  requires: StackSignalId[]
  reason: string
}> = [
  {
    plugin: 'typescript',
    requires: ['typescript'],
    reason: 'TypeScript is in use, so the typescript rules apply.',
  },
  {
    plugin: 'react',
    requires: ['react', 'nextjs'],
    reason: 'React is a dependency, so the react rules apply.',
  },
  {
    plugin: 'react-perf',
    requires: ['react-dom'],
    reason: 'React renders to the DOM here, where the react-perf rules catch re-render costs.',
  },
  {
    plugin: 'jsx-a11y',
    requires: ['jsx'],
    reason: 'JSX is present, so the accessibility rules have something to check.',
  },
  {
    plugin: 'nextjs',
    requires: ['nextjs'],
    reason: 'Next.js is in use; its rules catch framework-specific mistakes.',
  },
  { plugin: 'vue', requires: ['vue'], reason: 'Vue is in use, so the vue rules apply.' },
  {
    plugin: 'vitest',
    requires: ['vitest'],
    reason: 'Vitest is the test runner; its rules catch focused and skipped tests.',
  },
  {
    plugin: 'jest',
    requires: ['jest'],
    reason: 'Jest is the test runner; its rules catch focused and skipped tests.',
  },
  {
    plugin: 'node',
    requires: ['node'],
    reason: 'This package targets Node, so the node rules apply.',
  },
  {
    plugin: 'jsdoc',
    requires: ['jsdoc'],
    reason: 'A JSDoc toolchain is present, so doc comments are worth checking.',
  },
  {
    plugin: 'import',
    requires: ['esm', 'typescript'],
    reason: 'Module syntax is in use; the import rules catch unresolved and cyclic imports.',
  },
]

/**
 * Categories worth turning on for any JavaScript or TypeScript project.
 *
 * `correctness` and `suspicious` are Oxlint's own defaults and are stated explicitly so
 * the config does not depend on an implicit default that could change. The rest are left
 * alone: `pedantic`, `style`, `restriction` and `nursery` are matters of taste or are
 * unstable, and turning them on wholesale is exactly the kind of unasked-for churn this
 * tool should not create.
 */
const BASELINE_CATEGORIES: Array<{ category: OxlintCategory; severity: OxlintSeverity }> = [
  { category: 'correctness', severity: 'error' },
  { category: 'suspicious', severity: 'warn' },
]

/**
 * Individual rules that are off by default but catch mistakes with real consequences.
 *
 * Kept deliberately short. Each entry names a concrete failure it prevents, and every
 * rule here is verified against the tracked Oxlint inventory by the conformance test.
 */
const TARGETED_RULES: Array<{
  rule: string
  severity: OxlintSeverity
  requires: StackSignalId[]
  reason: string
}> = [
  {
    rule: 'no-eval',
    severity: 'error',
    requires: [],
    reason: 'Evaluating strings as code turns any untrusted input into arbitrary execution.',
  },
  {
    rule: 'no-new-func',
    severity: 'error',
    requires: [],
    reason: 'The Function constructor is eval by another name.',
  },
  {
    rule: 'no-script-url',
    severity: 'error',
    requires: [],
    reason: '`javascript:` URLs execute in the page origin.',
  },
  {
    rule: 'typescript/no-explicit-any',
    severity: 'warn',
    requires: ['typescript'],
    reason: '`any` silently disables the checks the rest of the config relies on.',
  },
  {
    rule: 'typescript/no-non-null-assertion',
    severity: 'warn',
    requires: ['typescript'],
    reason: 'Non-null assertions move a real runtime failure past the type checker.',
  },
  {
    rule: 'react/no-danger',
    severity: 'error',
    requires: ['react'],
    reason: 'dangerouslySetInnerHTML injects unescaped markup into the DOM.',
  },
  {
    rule: 'react/jsx-no-target-blank',
    severity: 'error',
    requires: ['jsx'],
    reason: '`target="_blank"` without `rel="noreferrer"` exposes `window.opener`.',
  },
  {
    rule: 'import/no-cycle',
    severity: 'warn',
    requires: ['esm', 'typescript'],
    reason: 'Import cycles produce partially-initialised modules at runtime.',
  },
  {
    rule: 'vitest/no-focused-tests',
    severity: 'error',
    requires: ['vitest'],
    reason: 'A committed `.only` silently stops the rest of the suite from running.',
  },
  {
    rule: 'jest/no-focused-tests',
    severity: 'error',
    requires: ['jest'],
    reason: 'A committed `.only` silently stops the rest of the suite from running.',
  },
]

/**
 * Type-aware rules, which run on Oxlint's tsgolint engine.
 *
 * Gated on the `tsgolint` signal rather than merely on TypeScript: without the
 * `oxlint-tsgolint` package, `oxlint --type-aware` fails with "Failed to find tsgolint
 * executable", so configuring these without it would produce a config the project cannot
 * run. When TypeScript is present but tsgolint is not, the capability is surfaced as a
 * prerequisite instead.
 *
 * Every rule here is checked against docs/tsgolint-rules.tsv, including its
 * `implemented` status, by the inventory conformance test.
 */
const TYPE_AWARE_RULES: Array<{ rule: string; severity: OxlintSeverity; reason: string }> = [
  {
    rule: 'typescript/no-floating-promises',
    severity: 'error',
    reason: 'An unawaited promise swallows its rejection, turning a failure into silence.',
  },
  {
    rule: 'typescript/await-thenable',
    severity: 'error',
    reason: 'Awaiting a non-promise is always a mistake and usually hides a missing call.',
  },
  {
    rule: 'typescript/no-misused-promises',
    severity: 'error',
    reason: 'Passing an async function where a void callback is expected drops its errors.',
  },
]

/**
 * Builds the full set of recommendations for a stack.
 *
 * This is a pure function of the stack: the same signals always produce the same
 * recommendations, in the same order.
 */
export function recommendForStack(stack: ProjectStack): Recommendation[] {
  const recommendations: Recommendation[] = []

  for (const { plugin, requires, reason } of PLUGIN_RULES) {
    const triggeredBy = requires.filter((signal) => hasSignal(stack, signal))

    if (triggeredBy.length > 0) {
      recommendations.push({ kind: 'plugin', target: plugin, reason, triggeredBy })
    }
  }

  for (const { category, severity } of BASELINE_CATEGORIES) {
    recommendations.push({
      kind: 'category',
      target: category,
      severity,
      reason: `Stated explicitly so the config does not depend on Oxlint's default for ${category}.`,
      triggeredBy: [],
    })
  }

  for (const { rule, severity, requires, reason } of TARGETED_RULES) {
    const triggeredBy = requires.filter((signal) => hasSignal(stack, signal))

    if (requires.length === 0 || triggeredBy.length > 0) {
      recommendations.push({ kind: 'rule', target: rule, severity, reason, triggeredBy })
    }
  }

  if (hasSignal(stack, 'tsgolint') && hasSignal(stack, 'tsconfig')) {
    recommendations.push({
      kind: 'option',
      target: 'typeAware',
      reason:
        'oxlint-tsgolint is installed, so the type-aware rules can run; the option has to be on for Oxlint to load them.',
      triggeredBy: ['tsgolint', 'tsconfig'],
    })

    for (const { rule, severity, reason } of TYPE_AWARE_RULES) {
      recommendations.push({
        kind: 'rule',
        target: rule,
        severity,
        reason,
        triggeredBy: ['tsgolint'],
      })
    }
  }

  return recommendations
}

/**
 * Capabilities the project could adopt but has not installed the tooling for.
 *
 * Reported instead of configured: writing type-aware config without the engine would
 * produce a config that fails at run time.
 */
export function findPrerequisites(stack: ProjectStack): Prerequisite[] {
  const prerequisites: Prerequisite[] = []

  if (hasSignal(stack, 'tsconfig') && !hasSignal(stack, 'tsgolint')) {
    prerequisites.push({
      capability: 'Type-aware linting',
      reason: `${TYPE_AWARE_RULES.length} type-aware rules (including no-floating-promises) need type information, which Oxlint gets from the tsgolint engine.`,
      install: 'pnpm add -D oxlint-tsgolint',
    })
  }

  // Oxlint parses these files and applies its universal rules, but ships no dedicated
  // plugin for either, so there is nothing framework-specific to recommend.
  for (const framework of ['svelte', 'astro'] as const) {
    if (hasSignal(stack, framework)) {
      prerequisites.push({
        capability: `${framework === 'svelte' ? 'Svelte' : 'Astro'}-specific rules`,
        reason: `Oxlint lints the script blocks in .${framework} files with its universal rules, but ships no ${framework} plugin, so no framework-specific rules are available yet.`,
        install: '(nothing to install — tracked upstream)',
      })
    }
  }

  return prerequisites
}

/** Type-aware rule names this recommender can emit, for tsgolint inventory checks. */
export function getTypeAwareRuleNames(): string[] {
  return TYPE_AWARE_RULES.map(({ rule }) => rule)
}

/** Every Oxlint rule name this recommender can emit, for inventory conformance checks. */
export function getRecommendableRuleNames(): string[] {
  return [...TARGETED_RULES.map(({ rule }) => rule), ...TYPE_AWARE_RULES.map(({ rule }) => rule)]
}

/** Every plugin this recommender can enable. */
export function getRecommendablePlugins(): OxlintBuiltinPlugin[] {
  return PLUGIN_RULES.map(({ plugin }) => plugin)
}
