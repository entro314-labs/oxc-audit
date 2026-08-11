import type {
  OxlintBuiltinPlugin,
  OxlintCategory,
  OxlintConfig,
  OxlintRuleSeverity,
  OxlintSeverity,
  Recommendation,
} from './types.js'

/**
 * Oxlint's base plugin set, from `oxlint --print-config` against an empty config.
 *
 * This matters because Oxlint's schema states: "Setting the `plugins` field will
 * overwrite the base set of plugins." Writing `plugins: ['react']` into a config that had
 * no `plugins` key would therefore *disable* unicorn, typescript and oxc. Any write of
 * the field has to carry the base set along.
 */
export const OXLINT_DEFAULT_PLUGINS: OxlintBuiltinPlugin[] = ['unicorn', 'typescript', 'oxc']

const SEVERITY_RANK: Record<OxlintSeverity, number> = { off: 0, warn: 1, error: 2 }

export interface MergeResult {
  config: OxlintConfig
  /** Recommendations written into the config. */
  applied: Recommendation[]
  /** Recommendations the config already met at equal or greater strength. */
  alreadySatisfied: Recommendation[]
  /** Recommendations the config explicitly turns off; left untouched. */
  explicitlyDisabled: Recommendation[]
  changed: boolean
}

/**
 * Merges recommendations into an existing Oxlint config, additively.
 *
 * Three invariants, in order of importance:
 *
 * 1. Nothing is ever removed. No rule, plugin, category, override or unknown field is
 *    dropped, including fields this tool does not understand.
 * 2. Nothing is ever weakened. A rule already at `error` stays at `error` even when only
 *    `warn` is recommended, and enabling any plugin carries Oxlint's base set along.
 * 3. An explicit `off` is a decision, not a gap. It is reported but never overwritten.
 *
 * Together these mean a run can only ever add checks. That is what makes it safe to run
 * repeatedly against a config someone else maintains.
 */
export function mergeRecommendations(
  existingConfig: OxlintConfig,
  recommendations: Recommendation[],
): MergeResult {
  // Shallow clone plus fresh containers for the three fields that get mutated. Every
  // other key, known or not, is carried across untouched.
  const config: OxlintConfig = { ...existingConfig }
  const applied: Recommendation[] = []
  const alreadySatisfied: Recommendation[] = []
  const explicitlyDisabled: Recommendation[] = []

  for (const recommendation of recommendations) {
    const outcome = applyRecommendation(config, recommendation)

    if (outcome === 'applied') {
      applied.push(recommendation)
    } else if (outcome === 'satisfied') {
      alreadySatisfied.push(recommendation)
    } else {
      explicitlyDisabled.push(recommendation)
    }
  }

  return { config, applied, alreadySatisfied, explicitlyDisabled, changed: applied.length > 0 }
}

type ApplyOutcome = 'applied' | 'satisfied' | 'disabled'

function applyRecommendation(config: OxlintConfig, recommendation: Recommendation): ApplyOutcome {
  if (recommendation.kind === 'plugin') {
    return applyPlugin(config, recommendation.target as OxlintBuiltinPlugin)
  }

  if (recommendation.kind === 'option') {
    return applyOption(config, recommendation.target)
  }

  if (recommendation.kind === 'category') {
    return applyCategory(
      config,
      recommendation.target as OxlintCategory,
      recommendation.severity ?? 'warn',
    )
  }

  return applyRule(config, recommendation.target, recommendation.severity ?? 'warn')
}

function applyPlugin(config: OxlintConfig, plugin: OxlintBuiltinPlugin): ApplyOutcome {
  // An absent `plugins` key means Oxlint's base set is active.
  const enabledPlugins = config.plugins ?? OXLINT_DEFAULT_PLUGINS

  if (enabledPlugins.includes(plugin)) {
    return 'satisfied'
  }

  // Carry the base set so writing the field does not disable what was implicitly on.
  config.plugins = [...new Set([...OXLINT_DEFAULT_PLUGINS, ...enabledPlugins, plugin])].sort()

  return 'applied'
}

function applyOption(config: OxlintConfig, option: string): ApplyOutcome {
  const key = option as keyof NonNullable<OxlintConfig['options']>
  const existing = config.options?.[key]

  // An explicit `false` is a decision to keep the capability off.
  if (existing === false) {
    return 'disabled'
  }

  if (existing === true) {
    return 'satisfied'
  }

  config.options = { ...config.options, [key]: true }

  return 'applied'
}

function applyCategory(
  config: OxlintConfig,
  category: OxlintCategory,
  severity: OxlintSeverity,
): ApplyOutcome {
  const existing = config.categories?.[category]

  if (existing === 'off') {
    return 'disabled'
  }

  if (existing !== undefined && SEVERITY_RANK[existing] >= SEVERITY_RANK[severity]) {
    return 'satisfied'
  }

  config.categories = { ...config.categories, [category]: severity }

  return 'applied'
}

function applyRule(config: OxlintConfig, rule: string, severity: OxlintSeverity): ApplyOutcome {
  const existing = config.rules?.[rule]

  if (existing !== undefined) {
    const existingSeverity = toSeverity(existing)

    if (existingSeverity === 'off') {
      return 'disabled'
    }

    if (SEVERITY_RANK[existingSeverity] >= SEVERITY_RANK[severity]) {
      return 'satisfied'
    }

    // The rule carries options. Raising the severity must not discard them.
    if (Array.isArray(existing)) {
      const [, ...options] = existing
      config.rules = { ...config.rules, [rule]: [severity, ...options] }
      return 'applied'
    }
  }

  config.rules = { ...config.rules, [rule]: severity }

  return 'applied'
}

/** Reads the severity out of either the bare or the `[severity, options]` rule form. */
export function toSeverity(value: OxlintRuleSeverity): OxlintSeverity {
  return Array.isArray(value) ? value[0] : value
}
