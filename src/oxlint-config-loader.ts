import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import type { ParseError as JsoncParseError } from 'jsonc-parser'

import { pathExists } from './fs-utils.js'
import type { OxlintConfig } from './types.js'

/** Config file names Oxlint looks for, most conventional first. */
export const OXLINT_CONFIG_NAMES = ['.oxlintrc.json', '.oxlintrc.jsonc', 'oxlintrc.json']

export interface LoadedOxlintConfig {
  path: string
  existed: boolean
  config: OxlintConfig
  /** Raw text of the file as read, or undefined when it did not exist. */
  originalText: string | undefined
}

export async function findOxlintConfig(projectDir: string): Promise<string | undefined> {
  for (const name of OXLINT_CONFIG_NAMES) {
    const candidate = resolve(projectDir, name)

    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

/**
 * Loads an existing Oxlint config, or returns an empty one when none exists.
 *
 * Parsed leniently with jsonc-parser: Oxlint accepts comments and trailing commas in its
 * config, and a config the tool itself accepts must not be rejected here. Note that
 * comments are lost on write - {@link LoadedOxlintConfig.originalText} is kept so a
 * caller can tell the user what they are about to lose.
 */
export async function loadOxlintConfig(configPath: string): Promise<LoadedOxlintConfig> {
  if (!(await pathExists(configPath))) {
    return { path: configPath, existed: false, config: {}, originalText: undefined }
  }

  const originalText = await readFile(configPath, 'utf-8')
  const parseErrors: JsoncParseError[] = []
  const parsed = parseJsonc(originalText, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: true,
  }) as unknown

  if (parseErrors.length > 0) {
    const formatted = parseErrors
      .map((issue) => `${printParseErrorCode(issue.error)} at offset ${issue.offset}`)
      .join('; ')
    throw new Error(`${configPath} is not valid JSON/JSONC: ${formatted}`)
  }

  if (parsed === undefined || parsed === null) {
    return { path: configPath, existed: true, config: {}, originalText }
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${configPath} must contain a JSON object at the top level.`)
  }

  return { path: configPath, existed: true, config: parsed as OxlintConfig, originalText }
}

/** True when the file carries comments that a rewrite would drop. */
export function containsComments(text: string | undefined): boolean {
  if (!text) {
    return false
  }

  const withoutStrings = text.replaceAll(/"(?:[^"\\]|\\.)*"/gu, '""')

  return withoutStrings.includes('//') || withoutStrings.includes('/*')
}
