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

/** Translate a Prettier config into the oxfmt keys that mean the same thing. */
export function fromPrettier(config: Record<string, unknown>): OxfmtConfig {
  const settings: Record<string, unknown> = {}

  for (const key of PRETTIER_KEYS) {
    const value = config[key satisfies PrettierKey]

    if (value !== undefined) {
      settings[key] = value
    }
  }

  return settings
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
  if (shared?.lineEnding !== undefined) settings.endOfLine = shared.lineEnding

  if (javascript?.quoteStyle !== undefined)
    settings.singleQuote = javascript.quoteStyle === 'single'
  if (javascript?.jsxQuoteStyle !== undefined) {
    settings.jsxSingleQuote = javascript.jsxQuoteStyle === 'single'
  }
  if (javascript?.semicolons !== undefined) settings.semi = javascript.semicolons !== 'asNeeded'
  if (javascript?.trailingCommas !== undefined) settings.trailingComma = javascript.trailingCommas
  if (javascript?.arrowParentheses !== undefined) {
    settings.arrowParens = javascript.arrowParentheses
  }
  if (javascript?.bracketSpacing !== undefined) settings.bracketSpacing = javascript.bracketSpacing
  if (javascript?.bracketSameLine !== undefined) {
    settings.bracketSameLine = javascript.bracketSameLine
  }
  if (javascript?.quoteProperties !== undefined) {
    settings.quoteProps = javascript.quoteProperties
  }

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
  return [...PRETTIER_KEYS, 'sortImports', 'sortPackageJson']
}
