import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import type { ParseError as JsoncParseError } from 'jsonc-parser'
import { parse as parseYaml } from 'yaml'

import {
  fromBiome,
  fromPrettier,
  prettierLeftovers,
  withSourceDefaults,
} from './format-recommender.js'
import type { ExistingFormatterConfig } from './format-recommender.js'
import { pathExists } from './fs-utils.js'
import type { OxfmtConfig, Reporter } from './types.js'

/** Config file names oxfmt looks for, most conventional first. */
export const OXFMT_CONFIG_NAMES = ['.oxfmtrc.jsonc', '.oxfmtrc.json', 'oxfmtrc.json']

/**
 * Prettier config files this tool can read, in Prettier's own lookup order after the
 * `prettier` key of package.json.
 *
 * Only the declarative forms. `.prettierrc.js` and `prettier.config.mjs` are code, and
 * running a project's config file to find out how it formats is not something an audit
 * should do; those are reported as unreadable instead, as is TOML, which nothing here
 * parses. `.prettierrc` may hold JSON or YAML.
 */
const PRETTIER_CONFIG_NAMES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.jsonc',
  '.prettierrc.json5',
]
const PRETTIER_UNREADABLE_NAMES = [
  '.prettierrc.toml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.ts',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'prettier.config.ts',
]
const BIOME_CONFIG_NAMES = ['biome.json', 'biome.jsonc']

export interface LoadedOxfmtConfig {
  path: string
  existed: boolean
  config: OxfmtConfig
  originalText: string | undefined
}

async function readJsoncObject(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(path, 'utf-8')
  const parseErrors: JsoncParseError[] = []
  const parsed = parseJsonc(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: true,
  }) as unknown

  if (parseErrors.length > 0) {
    const formatted = parseErrors
      .map((issue) => `${printParseErrorCode(issue.error)} at offset ${issue.offset}`)
      .join('; ')
    throw new Error(`${path} is not valid JSON/JSONC: ${formatted}`)
  }

  if (parsed === undefined || parsed === null) {
    return undefined
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${path} must contain a JSON object at the top level.`)
  }

  return parsed as Record<string, unknown>
}

export async function findOxfmtConfig(projectDir: string): Promise<string | undefined> {
  for (const name of OXFMT_CONFIG_NAMES) {
    const candidate = resolve(projectDir, name)

    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

export async function loadOxfmtConfig(configPath: string): Promise<LoadedOxfmtConfig> {
  if (!(await pathExists(configPath))) {
    return { path: configPath, existed: false, config: {}, originalText: undefined }
  }

  const originalText = await readFile(configPath, 'utf-8')

  return {
    path: configPath,
    existed: true,
    config: (await readJsoncObject(configPath)) ?? {},
    originalText,
  }
}

/**
 * Find the formatter settings the project already follows.
 *
 * Prettier is checked before Biome only because a repo carrying both is almost always
 * mid-migration, and the Prettier config is the one the committed formatting came from.
 * A malformed config is reported and skipped rather than aborting the audit - the linter
 * half of the run is still worth completing.
 */
export async function findExistingFormatterConfig(
  projectDir: string,
  reporter: Reporter,
): Promise<ExistingFormatterConfig | undefined> {
  const found = await findSourceFormatterConfig(projectDir, reporter)

  if (found === undefined) {
    return undefined
  }

  return withSourceDefaults(found, {
    editorconfigSetsWidth: await editorconfigSetsWidth(projectDir),
  })
}

async function editorconfigSetsWidth(projectDir: string): Promise<boolean> {
  const path = resolve(projectDir, '.editorconfig')

  return (await pathExists(path)) && /^\s*max_line_length\s*=/mu.test(await readFile(path, 'utf-8'))
}

/** A Prettier config, reporting what it holds that oxfmt cannot carry. */
function fromPrettierReporting(
  config: Record<string, unknown>,
  name: string,
  reporter: Reporter,
): ExistingFormatterConfig {
  const leftovers = prettierLeftovers(config)

  if (leftovers.length > 0) {
    reporter.warn(
      `${name} has settings with no oxfmt equivalent, which were not carried across: ${leftovers.join(', ')}.`,
    )
  }

  return { source: 'prettier', settings: fromPrettier(config) }
}

/**
 * `.prettierrc` is JSON or YAML; JSON with comments is tried first, since YAML would read
 * a `//` comment as text.
 */
async function readPrettierObject(path: string): Promise<Record<string, unknown> | undefined> {
  if (/\.ya?ml$/u.test(path)) {
    return asObject(parseYaml(await readFile(path, 'utf-8')), path)
  }

  if (!path.endsWith('.prettierrc')) {
    return readJsoncObject(path)
  }

  try {
    return await readJsoncObject(path)
  } catch {
    return asObject(parseYaml(await readFile(path, 'utf-8')), path)
  }
}

function asObject(parsed: unknown, path: string): Record<string, unknown> | undefined {
  if (parsed === undefined || parsed === null) {
    return undefined
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${path} must contain an object at the top level.`)
  }

  return parsed as Record<string, unknown>
}

async function findSourceFormatterConfig(
  projectDir: string,
  reporter: Reporter,
): Promise<ExistingFormatterConfig | undefined> {
  const manifestPath = resolve(projectDir, 'package.json')

  if (await pathExists(manifestPath)) {
    // A manifest that does not parse is the stack detector's to report; here it only means
    // there is no `prettier` key to read.
    const prettier = (await readJsoncObject(manifestPath).catch(() => undefined))?.prettier

    if (typeof prettier === 'string') {
      reporter.warn(
        `package.json points Prettier at the shared config ${prettier}, which this tool does not resolve. Its settings were not carried into the oxfmt config - copy them by hand.`,
      )
      return undefined
    }

    const config = asObject(prettier, `${manifestPath}#prettier`)

    if (config) {
      return fromPrettierReporting(config, 'The prettier key of package.json', reporter)
    }
  }

  for (const name of PRETTIER_CONFIG_NAMES) {
    const candidate = resolve(projectDir, name)

    if (!(await pathExists(candidate))) {
      continue
    }

    try {
      const parsed = await readPrettierObject(candidate)

      if (parsed) {
        return fromPrettierReporting(parsed, name, reporter)
      }
    } catch (err) {
      reporter.warn(
        `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}. Formatter settings were not carried across.`,
      )
    }
  }

  for (const name of PRETTIER_UNREADABLE_NAMES) {
    if (await pathExists(resolve(projectDir, name))) {
      reporter.warn(
        `${name} is ${name.endsWith('.toml') ? 'TOML' : 'a JavaScript module'}, which this tool does not ${name.endsWith('.toml') ? 'parse' : 'execute'}. Its settings were not carried into the oxfmt config - copy them by hand.`,
      )
      return undefined
    }
  }

  for (const name of BIOME_CONFIG_NAMES) {
    const candidate = resolve(projectDir, name)

    if (!(await pathExists(candidate))) {
      continue
    }

    try {
      const parsed = await readJsoncObject(candidate)

      if (parsed) {
        if (asObject(parsed.formatter, name)?.lineEnding === 'auto') {
          reporter.warn(
            `${name} sets lineEnding to auto, which oxfmt does not support. It was not carried across; oxfmt writes lf unless told otherwise.`,
          )
        }

        return { source: 'biome', settings: fromBiome(parsed) }
      }
    } catch (err) {
      reporter.warn(
        `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}. Formatter settings were not carried across.`,
      )
    }
  }

  return undefined
}

/**
 * Merge recommended formatter settings into an existing config, additively.
 *
 * The same invariant the linter half holds: a key already present is a decision, and is
 * never overwritten. Only genuinely absent keys are added, so a repeated run cannot walk
 * a project's formatting away from what it chose.
 */
export function mergeFormatterConfig(
  existing: OxfmtConfig,
  recommended: OxfmtConfig,
): { config: OxfmtConfig; added: string[] } {
  const config: OxfmtConfig = { ...existing }
  const added: string[] = []

  for (const [key, value] of Object.entries(recommended)) {
    if (key in config) {
      continue
    }

    config[key] = value
    added.push(key)
  }

  return { config, added }
}
