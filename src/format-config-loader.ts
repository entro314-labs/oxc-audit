import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import type { ParseError as JsoncParseError } from 'jsonc-parser'

import { fromBiome, fromPrettier } from './format-recommender.js'
import type { ExistingFormatterConfig } from './format-recommender.js'
import { pathExists } from './fs-utils.js'
import type { OxfmtConfig, Reporter } from './types.js'

/** Config file names oxfmt looks for, most conventional first. */
export const OXFMT_CONFIG_NAMES = ['.oxfmtrc.jsonc', '.oxfmtrc.json', 'oxfmtrc.json']

/**
 * Prettier config files this tool can read.
 *
 * Only the declarative forms. `.prettierrc.js` and `prettier.config.mjs` are code, and
 * running a project's config file to find out how it formats is not something an audit
 * should do; those are reported as unreadable instead.
 */
const PRETTIER_CONFIG_NAMES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.jsonc',
  '.prettierrc.json5',
]
const PRETTIER_EXECUTABLE_NAMES = [
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
  for (const name of PRETTIER_CONFIG_NAMES) {
    const candidate = resolve(projectDir, name)

    if (!(await pathExists(candidate))) {
      continue
    }

    try {
      const parsed = await readJsoncObject(candidate)

      if (parsed) {
        return { source: 'prettier', settings: fromPrettier(parsed) }
      }
    } catch (err) {
      reporter.warn(
        `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}. Formatter settings were not carried across.`,
      )
    }
  }

  for (const name of PRETTIER_EXECUTABLE_NAMES) {
    if (await pathExists(resolve(projectDir, name))) {
      reporter.warn(
        `${name} is a JavaScript module, which this tool does not execute. Its settings were not carried into the oxfmt config - copy them by hand.`,
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
