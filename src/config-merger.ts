import type {
  OxlintBuiltinPlugin,
  OxlintCategory,
  OxlintConfig,
  OxlintJsPlugin,
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
 * repeatedly against a config someone else maintains. The recommendations that read as a
 * removal - an `off` for a rule the evidence proves cannot apply, rule options that narrow
 * what a rule reports, an override that relaxes a rule for some files - are written only
 * into gaps, so they remove nothing the project put there.
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
    const outcome = applyRecommendation(config, recommendation, existingConfig)

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

function applyRecommendation(
  config: OxlintConfig,
  recommendation: Recommendation,
  original: OxlintConfig,
): ApplyOutcome {
  if (recommendation.kind === 'plugin') {
    return applyPlugin(config, recommendation.target as OxlintBuiltinPlugin)
  }

  if (recommendation.kind === 'js-plugin') {
    return applyJsPlugin(config, recommendation.target, recommendation.specifier)
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

  if (recommendation.kind === 'env') {
    return applyEnv(config, recommendation.target)
  }

  const severity = recommendation.severity ?? 'warn'

  if (recommendation.files !== undefined) {
    return applyOverrideRule(
      config,
      original,
      recommendation.files,
      recommendation.target,
      severity,
    )
  }

  return applyRule(config, recommendation.target, severity, recommendation.options ?? [])
}

function applyEnv(config: OxlintConfig, env: string): ApplyOutcome {
  const existing = config.env?.[env]

  // An explicit `false` says the code does not run there.
  if (existing === false) {
    return 'disabled'
  }

  if (existing === true) {
    return 'satisfied'
  }

  config.env = { ...config.env, [env]: true }

  return 'applied'
}

/**
 * Writes a rule into the override for `files`, creating that override when no existing one
 * has the same globs.
 *
 * Scoped entries narrow a top-level rule for some files, so they are written only where the
 * top level is this run's own doing: when the config the run started from already named
 * the rule, the project has decided how it applies, and an override would quietly change
 * that decision for part of the tree.
 */
function applyOverrideRule(
  config: OxlintConfig,
  original: OxlintConfig,
  files: string[],
  rule: string,
  severity: OxlintSeverity,
): ApplyOutcome {
  const overrides = config.overrides ?? []
  const index = overrides.findIndex((override) => sameGlobs(override.files, files))
  const existing = index === -1 ? undefined : overrides[index]

  if (existing?.rules?.[rule] !== undefined) {
    return 'satisfied'
  }

  if (original.rules?.[rule] !== undefined) {
    return 'satisfied'
  }

  const next = existing
    ? { ...existing, rules: { ...existing.rules, [rule]: severity } }
    : { files, rules: { [rule]: severity } }

  config.overrides =
    index === -1
      ? [...overrides, next]
      : overrides.map((entry, at) => (at === index ? next : entry))

  return 'applied'
}

function sameGlobs(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((glob) => right.includes(glob))
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

/** The plugin name an existing `jsPlugins` entry registers, in either of its two forms. */
function jsPluginName(entry: OxlintJsPlugin): string {
  if (typeof entry !== 'string') {
    return entry.name
  }

  // The bare-string form takes its name from the plugin's own `meta.name`, which is not
  // readable from here. The last segment, after any `/index.*` file, is the package
  // subpath or directory the plugin ships in, which is how the package lays them out.
  const segments = entry.replace(/\/index\.[cm]?[jt]s$/u, '').split('/')

  return segments.at(-1) ?? entry
}

function applyJsPlugin(
  config: OxlintConfig,
  plugin: string,
  specifier: string | undefined,
): ApplyOutcome {
  // Without a path there is nothing loadable to write; treated as satisfied so a caller
  // that omits it cannot produce a config Oxlint refuses to start on.
  if (specifier === undefined) {
    return 'satisfied'
  }

  const existing = config.jsPlugins ?? []

  if (existing.some((entry) => jsPluginName(entry) === plugin)) {
    return 'satisfied'
  }

  config.jsPlugins = [...existing, { name: plugin, specifier }]

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

function applyRule(
  config: OxlintConfig,
  rule: string,
  severity: OxlintSeverity,
  options: unknown[],
): ApplyOutcome {
  const existing = config.rules?.[rule]

  // An `off` is recommended only on evidence that the rule cannot apply to the project.
  // It fills a gap and never overrides: any explicit value, a re-enable included, is the
  // project's decision and stands.
  if (severity === 'off') {
    if (existing !== undefined) {
      return 'satisfied'
    }

    config.rules = { ...config.rules, [rule]: 'off' }

    return 'applied'
  }

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

  config.rules = {
    ...config.rules,
    // Options go only into a gap. An entry the project wrote keeps its own shape, so a
    // recommendation can never loosen a rule the project configured.
    [rule]: existing === undefined && options.length > 0 ? [severity, ...options] : severity,
  }

  return 'applied'
}

/** Reads the severity out of either the bare or the `[severity, options]` rule form. */
export function toSeverity(value: OxlintRuleSeverity): OxlintSeverity {
  return Array.isArray(value) ? value[0] : value
}
