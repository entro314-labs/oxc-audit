import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import type { ParseError as JsoncParseError } from 'jsonc-parser'

import { pathExists } from './fs-utils.js'
import type { OxlintConfig } from './types.js'

/** JSON config file names Oxlint looks for, most conventional first. */
export const OXLINT_CONFIG_NAMES = ['.oxlintrc.json', '.oxlintrc.jsonc', 'oxlintrc.json']

/**
 * Module config file names Oxlint also discovers. A `.js` or `.mjs` config is loaded only
 * when passed with `--config`, so neither is looked for here.
 *
 * Oxlint refuses to start when a directory holds both a module config and an
 * `.oxlintrc.json` — "Only one of `.oxlintrc.json` and `oxlint.config.ts` is allowed per
 * directory" — so creating the JSON file beside one would take the project's linting from
 * working to not running at all.
 */
export const OXLINT_MODULE_CONFIG_NAMES = ['oxlint.config.ts', 'oxlint.config.mts']

/** The module config in this directory, if one exists. */
export async function findOxlintModuleConfig(projectDir: string): Promise<string | undefined> {
  for (const name of OXLINT_MODULE_CONFIG_NAMES) {
    const candidate = resolve(projectDir, name)

    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

export interface LoadedOxlintConfig {
  path: string
  existed: boolean
  config: OxlintConfig
  /** Raw text of the file as read, or undefined when it did not exist. */
  originalText: string | undefined
}

/** The module config this tool creates when asked for a TypeScript config. */
export const OXLINT_TS_CONFIG_NAME = 'oxlint.config.ts'

/**
 * True when `oxlint` resolves from the project, which a new module config needs: it imports
 * `defineConfig` from there, so without it every later load of the file fails.
 */
export function canResolveOxlint(projectDir: string): boolean {
  try {
    createRequire(resolve(projectDir, 'package.json')).resolve('oxlint/package.json')
    return true
  } catch {
    return false
  }
}

/** True for a config Oxlint loads by importing it rather than parsing it as JSON. */
export function isModuleConfigPath(configPath: string): boolean {
  return ['.ts', '.mts', '.js', '.mjs'].includes(extname(configPath))
}

/** The existing config in this directory, JSON first, then module. */
export async function findOxlintConfig(projectDir: string): Promise<string | undefined> {
  for (const name of [...OXLINT_CONFIG_NAMES, ...OXLINT_MODULE_CONFIG_NAMES]) {
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

  if (isModuleConfigPath(configPath)) {
    return loadOxlintModuleConfig(configPath)
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

  return { path: configPath, existed: true, config: parsed, originalText }
}

/**
 * Loads `oxlint.config.ts` and its siblings by importing them, as Oxlint itself does.
 *
 * Importing runs the file, which is what Oxlint does on every lint run, so it runs nothing
 * the project does not already run. The query string defeats Node's module cache, so a
 * config rewritten earlier in the same process is read fresh.
 */
async function loadOxlintModuleConfig(configPath: string): Promise<LoadedOxlintConfig> {
  const originalText = await readFile(configPath, 'utf-8')
  const url = pathToFileURL(configPath)
  url.searchParams.set('oxc-audit', String(Date.now()))

  let exported: unknown
  try {
    const loaded: unknown = await import(url.href)
    exported =
      typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'default') : undefined
  } catch (err) {
    throw new Error(
      `Could not load ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  if (typeof exported !== 'object' || exported === null || Array.isArray(exported)) {
    throw new TypeError(`${configPath} must export a config object as its default export.`)
  }

  return { path: configPath, existed: true, config: exported, originalText }
}

/** The file text for `config` in the format `configPath` calls for. */
export function serializeOxlintConfig(configPath: string, config: OxlintConfig): string {
  const json = JSON.stringify(config, null, 2)

  if (isModuleConfigPath(configPath)) {
    return `import { defineConfig } from 'oxlint'\n\nexport default defineConfig(${json})\n`
  }

  return `${json}\n`
}

/**
 * True when a module config is nothing but a plain config object — the file this tool
 * would write for it, or the same object exported without `defineConfig` — give or take
 * formatting.
 *
 * Only such a file can be rewritten without loss. Anything else — another import, an
 * `extends` of an imported config, a value computed from the environment — evaluates to
 * literals on load, and writing those literals back would freeze or drop the code that
 * produced them. The comparison runs on tokens with formatting erased, so a file reformatted
 * by oxfmt still matches; any difference it cannot erase counts as a mismatch, which only
 * ever errs towards leaving the file alone.
 */
export function isPlainModuleConfig(
  configPath: string,
  text: string,
  config: OxlintConfig,
): boolean {
  const actual = canonicalTokens(text)?.join('\n')

  return (
    actual !== undefined &&
    [serializeOxlintConfig(configPath, config), `export default ${JSON.stringify(config)}`].some(
      (plain) => canonicalTokens(plain)?.join('\n') === actual,
    )
  )
}

const TOKEN_PATTERN =
  /\s+|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[A-Za-z_$][\w$]*|-?\d[\d.eE+-]*|[^\s]/gu

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u

/**
 * JavaScript tokens with the differences a formatter introduces erased: whitespace,
 * semicolons, trailing commas, quote style, and quoted versus bare property keys. Strings
 * are re-encoded as JSON. Undefined when a string literal cannot be decoded.
 */
function canonicalTokens(source: string): string[] | undefined {
  const raw: string[] = []

  for (const [token] of source.matchAll(TOKEN_PATTERN)) {
    if (/^\s/u.test(token) || token === ';') {
      continue
    }

    if (token.startsWith('"') || token.startsWith("'")) {
      const value = decodeStringLiteral(token)

      if (value === undefined) {
        return undefined
      }

      raw.push(JSON.stringify(value))
      continue
    }

    raw.push(token)
  }

  const tokens: string[] = []

  for (const [index, token] of raw.entries()) {
    const next = raw[index + 1]

    if (token === ',' && (next === '}' || next === ']' || next === ')')) {
      continue
    }

    if (next === ':' && token.startsWith('"')) {
      const key = JSON.parse(token) as string
      tokens.push(IDENTIFIER.test(key) ? key : token)
      continue
    }

    tokens.push(token)
  }

  return tokens
}

function decodeStringLiteral(literal: string): string | undefined {
  const body = literal.slice(1, -1)
  const asJson = literal.startsWith("'")
    ? body.replaceAll("\\'", "'").replaceAll(/(?<!\\)"/gu, '\\"')
    : body

  try {
    return JSON.parse(`"${asJson}"`) as string
  } catch {
    return undefined
  }
}

/** True when the file carries comments that a rewrite would drop. */
export function containsComments(text: string | undefined): boolean {
  if (!text) {
    return false
  }

  const withoutStrings = text.replaceAll(/"(?:[^"\\]|\\.)*"/gu, '""')

  return withoutStrings.includes('//') || withoutStrings.includes('/*')
}
