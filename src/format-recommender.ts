import { hasSignal } from './stack-detector.js'
import type { OxfmtConfig, ProjectStack } from './types.js'

/**
 * Formatter settings this tool understands, and the Prettier key each corresponds to.
 *
 * oxfmt is Prettier-compatible by design, so every one of these carries across unchanged.
 * Keys outside this map are left where they are rather than guessed at - a Prettier config
 * can hold plugin settings that have no oxfmt equivalent, and inventing one would produce
 * a formatter config that reformats the codebase differently from what it says.
 */
const PRETTIER_KEYS = [
  'arrowParens',
  'bracketSameLine',
  'bracketSpacing',
  'embeddedLanguageFormatting',
  'endOfLine',
  'experimentalOperatorPosition',
  'htmlWhitespaceSensitivity',
  'jsxSingleQuote',
  'objectWrap',
  'printWidth',
  'proseWrap',
  'quoteProps',
  'semi',
  'singleAttributePerLine',
  'singleQuote',
  'tabWidth',
  'trailingComma',
  'useTabs',
  'vueIndentScriptAndStyle',
] as const

type PrettierKey = (typeof PRETTIER_KEYS)[number]

/**
 * Biome's formatter settings, and the Prettier/oxfmt key each maps onto.
 *
 * Biome nests and renames; only the settings with an exact equivalent are carried. Biome's
 * `indentStyle` becomes `useTabs`, and its `quoteStyle` becomes `singleQuote`, because
 * those are the same decision spelled differently rather than a judgement call.
 */
interface BiomeFormatterSettings {
  readonly indentStyle?: string
  readonly indentWidth?: number
  readonly lineWidth?: number
  readonly lineEnding?: string
}

interface BiomeJavascriptFormatterSettings {
  readonly quoteStyle?: string
  readonly jsxQuoteStyle?: string
  readonly semicolons?: string
  readonly trailingCommas?: string
  readonly arrowParentheses?: string
  readonly bracketSpacing?: boolean
  readonly bracketSameLine?: boolean
  readonly quoteProperties?: string
}

export interface ExistingFormatterConfig {
  /** Which tool the settings were read from, for the reported reason. */
  readonly source: 'prettier' | 'biome'
  readonly settings: OxfmtConfig
}

/**
 * Biome enum values whose oxfmt spelling differs. A value copied across unchanged makes
 * oxfmt refuse the whole file ("unknown variant `asNeeded`"), so only values with a known
 * counterpart are carried, and an unrecognised one is left behind like any other key with
 * no equivalent.
 */
const BIOME_ARROW_PARENTHESES: Record<string, string> = { always: 'always', asNeeded: 'avoid' }
const BIOME_QUOTE_PROPERTIES: Record<string, string> = {
  asNeeded: 'as-needed',
  preserve: 'preserve',
}

/**
 * Line endings oxfmt accepts. Prettier and Biome also accept `auto`, which oxfmt rejects
 * along with the rest of the file ("unknown variant `auto`"), so it is never carried.
 */
const OXFMT_LINE_ENDINGS = new Set(['lf', 'crlf', 'cr'])

/**
 * `prettier-plugin-tailwindcss` options, and the oxfmt `sortTailwindcss` key each becomes.
 * oxfmt implements the plugin's sorting itself and drops the `tailwind` prefix.
 */
const TAILWIND_PLUGIN_KEYS: Record<string, string> = {
  tailwindAttributes: 'attributes',
  tailwindConfig: 'config',
  tailwindFunctions: 'functions',
  tailwindPreserveDuplicates: 'preserveDuplicates',
  tailwindPreserveWhitespace: 'preserveWhitespace',
  tailwindStylesheet: 'stylesheet',
}

const TAILWIND_PLUGIN = 'prettier-plugin-tailwindcss'

/** Translate a Prettier config into the oxfmt keys that mean the same thing. */
export function fromPrettier(config: Record<string, unknown>): OxfmtConfig {
  const settings: Record<string, unknown> = {}

  for (const key of PRETTIER_KEYS) {
    const value = config[key satisfies PrettierKey]

    if (value === undefined) {
      continue
    }

    if (key === 'endOfLine' && !OXFMT_LINE_ENDINGS.has(String(value))) {
      continue
    }

    settings[key] = value
  }

  if (prettierPlugins(config).includes(TAILWIND_PLUGIN)) {
    const tailwind: Record<string, unknown> = {}

    for (const [prettierKey, oxfmtKey] of Object.entries(TAILWIND_PLUGIN_KEYS)) {
      if (config[prettierKey] !== undefined) {
        tailwind[oxfmtKey] = config[prettierKey]
      }
    }

    settings.sortTailwindcss = Object.keys(tailwind).length > 0 ? tailwind : true
  }

  return settings
}

function prettierPlugins(config: Record<string, unknown>): string[] {
  return Array.isArray(config.plugins)
    ? config.plugins.filter((plugin): plugin is string => typeof plugin === 'string')
    : []
}

/**
 * The parts of a Prettier config {@link fromPrettier} leaves behind, for reporting: keys
 * with no oxfmt counterpart, plugins other than the Tailwind one oxfmt implements, and an
 * `endOfLine` oxfmt rejects.
 */
export function prettierLeftovers(config: Record<string, unknown>): string[] {
  const carried = new Set<string>([...PRETTIER_KEYS, 'plugins', '$schema'])

  if (prettierPlugins(config).includes(TAILWIND_PLUGIN)) {
    for (const key of Object.keys(TAILWIND_PLUGIN_KEYS)) carried.add(key)
  }

  return [
    ...Object.keys(config).filter((key) => !carried.has(key)),
    ...prettierPlugins(config)
      .filter((plugin) => plugin !== TAILWIND_PLUGIN)
      .map((plugin) => `plugin ${plugin}`),
    ...(config.endOfLine !== undefined && !OXFMT_LINE_ENDINGS.has(String(config.endOfLine))
      ? [`endOfLine: ${String(config.endOfLine)}`]
      : []),
  ]
}

/**
 * The defaults the source formatter applied that oxfmt does not share, for every setting
 * the source config left unset.
 *
 * Without these, a project formatted by Prettier's or Biome's defaults is reformatted
 * wholesale on the first oxfmt run: oxfmt wraps at 100 columns where both wrap at 80, and
 * Biome indents with tabs. A `max_line_length` in `.editorconfig` is read by Prettier and
 * oxfmt alike, so the width is pinned only when there is none.
 */
export function withSourceDefaults(
  existing: ExistingFormatterConfig,
  options: { editorconfigSetsWidth: boolean },
): ExistingFormatterConfig {
  const settings = { ...existing.settings }

  if (!options.editorconfigSetsWidth) {
    settings.printWidth ??= 80
  }

  if (existing.source === 'biome') {
    settings.useTabs ??= true
  }

  return { ...existing, settings }
}

/** Translate the formatter half of a Biome config into oxfmt keys. */
export function fromBiome(config: {
  formatter?: BiomeFormatterSettings
  javascript?: { formatter?: BiomeJavascriptFormatterSettings }
}): OxfmtConfig {
  const settings: Record<string, unknown> = {}
  const shared = config.formatter
  const javascript = config.javascript?.formatter

  if (shared?.indentStyle !== undefined) settings.useTabs = shared.indentStyle === 'tab'
  if (shared?.indentWidth !== undefined) settings.tabWidth = shared.indentWidth
  if (shared?.lineWidth !== undefined) settings.printWidth = shared.lineWidth
  if (shared?.lineEnding !== undefined && OXFMT_LINE_ENDINGS.has(shared.lineEnding)) {
    settings.endOfLine = shared.lineEnding
  }

  if (javascript?.quoteStyle !== undefined)
    settings.singleQuote = javascript.quoteStyle === 'single'
  if (javascript?.jsxQuoteStyle !== undefined) {
    settings.jsxSingleQuote = javascript.jsxQuoteStyle === 'single'
  }
  if (javascript?.semicolons !== undefined) settings.semi = javascript.semicolons !== 'asNeeded'
  if (javascript?.trailingCommas !== undefined) settings.trailingComma = javascript.trailingCommas
  const arrowParens = BIOME_ARROW_PARENTHESES[javascript?.arrowParentheses ?? '']
  if (arrowParens !== undefined) settings.arrowParens = arrowParens
  if (javascript?.bracketSpacing !== undefined) settings.bracketSpacing = javascript.bracketSpacing
  if (javascript?.bracketSameLine !== undefined) {
    settings.bracketSameLine = javascript.bracketSameLine
  }
  const quoteProps = BIOME_QUOTE_PROPERTIES[javascript?.quoteProperties ?? '']
  if (quoteProps !== undefined) settings.quoteProps = quoteProps

  return settings
}

/**
 * The formatter settings a project should end up with.
 *
 * An existing Prettier or Biome config wins over every default: the codebase is already
 * formatted that way, and imposing different defaults would rewrite every file on the first
 * run. Defaults only fill in what nothing has an opinion about.
 *
 * `ignorePatterns` is never written. oxfmt already respects `.gitignore`, and a guessed
 * ignore list is how a formatter quietly stops covering part of a codebase.
 */
export function recommendFormatterConfig(
  stack: ProjectStack,
  existing: ExistingFormatterConfig | undefined,
): OxfmtConfig {
  const settings: OxfmtConfig = { ...existing?.settings }

  // Import sorting has no Prettier equivalent to inherit, and it is the one thing oxfmt
  // does that a Prettier setup demonstrably was not doing.
  settings.sortImports ??= { groups: ['builtin', 'external', 'internal', 'parent', 'sibling'] }

  if (hasSignal(stack, 'monorepo') || stack.packageJsonPath !== undefined) {
    settings.sortPackageJson ??= true
  }

  return settings
}

/** Every oxfmt key this tool can write, for the inventory conformance check. */
export function getRecommendableFormatterKeys(): string[] {
  return [...PRETTIER_KEYS, 'sortImports', 'sortPackageJson', 'sortTailwindcss']
}
