import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isPathNotFoundError } from './fs-utils.js'

export interface WorkspaceDeclaration {
  /** The file the globs were read from, for reporting. */
  source: string
  /** Positive globs selecting packages. */
  include: string[]
  /** Negated globs (`!pattern`) excluding packages the workspace deliberately omits. */
  exclude: string[]
}

/**
 * Reads a workspace's declared package globs.
 *
 * Honouring the declaration matters because exclusions are deliberate. A repo can carry a
 * package it keeps out of the workspace on purpose - a React Native app that must own its
 * own dependency graph, say - and writing config into it is exactly the unrequested change
 * this tool avoids elsewhere.
 *
 * Returns `undefined` when no declaration exists, leaving the caller to fall back to
 * plain discovery.
 */
export async function readWorkspaceDeclaration(
  rootDir: string,
): Promise<WorkspaceDeclaration | undefined> {
  return (
    (await readPnpmWorkspace(rootDir)) ??
    (await readJsonWorkspace(rootDir, 'package.json', 'workspaces')) ??
    (await readJsonWorkspace(rootDir, 'lerna.json', 'packages'))
  )
}

/** Splits raw globs into positive selectors and `!` exclusions. */
function toDeclaration(source: string, globs: string[]): WorkspaceDeclaration | undefined {
  const include: string[] = []
  const exclude: string[] = []

  for (const glob of globs) {
    if (glob.startsWith('!')) {
      exclude.push(glob.slice(1))
      continue
    }

    include.push(glob)
  }

  return include.length > 0 ? { source, include, exclude } : undefined
}

async function readJsonWorkspace(
  rootDir: string,
  fileName: string,
  field: string,
): Promise<WorkspaceDeclaration | undefined> {
  const content = await readFileOrUndefined(join(rootDir, fileName))

  if (content === undefined) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }

  if (typeof parsed !== 'object' || parsed === null || !(field in parsed)) {
    return undefined
  }

  const value = (parsed as Record<string, unknown>)[field]
  // npm and Yarn accept both `workspaces: []` and `workspaces: { packages: [] }`.
  const globs = Array.isArray(value)
    ? value
    : typeof value === 'object' &&
        value !== null &&
        Array.isArray((value as { packages?: unknown }).packages)
      ? (value as { packages: unknown[] }).packages
      : undefined

  if (!globs) {
    return undefined
  }

  return toDeclaration(
    fileName,
    globs.filter((glob): glob is string => typeof glob === 'string'),
  )
}

/**
 * Extracts the `packages:` list from `pnpm-workspace.yaml`.
 *
 * A targeted reader rather than a YAML parser: the field is a top-level key holding a flat
 * sequence of strings, which is a small enough shape to read exactly, and pulling in a
 * YAML dependency to read one list would be disproportionate. Anything it cannot make
 * sense of yields `undefined`, and the caller falls back to plain discovery.
 */
async function readPnpmWorkspace(rootDir: string): Promise<WorkspaceDeclaration | undefined> {
  for (const fileName of ['pnpm-workspace.yaml', 'pnpm-workspace.yml']) {
    const content = await readFileOrUndefined(join(rootDir, fileName))

    if (content === undefined) {
      continue
    }

    const globs: string[] = []
    let insidePackages = false

    for (const rawLine of content.split(/\r?\n/u)) {
      const line = stripComment(rawLine)

      if (/^packages:\s*$/u.test(line)) {
        insidePackages = true
        continue
      }

      if (!insidePackages) {
        continue
      }

      const item = /^\s+-\s*(.+)$/u.exec(line)

      if (item?.[1]) {
        globs.push(unquote(item[1].trim()))
        continue
      }

      // A non-indented, non-empty line ends the sequence.
      if (line.trim().length > 0 && !/^\s/u.test(line)) {
        break
      }
    }

    const declaration = toDeclaration(fileName, globs)

    if (declaration) {
      return declaration
    }
  }

  return undefined
}

/** Removes a trailing `#` comment, ignoring `#` inside quotes. */
function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]

    if (char === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (char === '#' && !inSingle && !inDouble) {
      return line.slice(0, index)
    }
  }

  return line
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/u.exec(value)

  return quoted?.[2] ?? value
}

/** True when a package path is selected by the declaration. */
export function matchesDeclaration(
  relativeDir: string,
  declaration: WorkspaceDeclaration,
): boolean {
  const normalized = relativeDir.replaceAll('\\', '/')

  if (declaration.exclude.some((glob) => matchesGlob(normalized, glob))) {
    return false
  }

  return declaration.include.some((glob) => matchesGlob(normalized, glob))
}

/** Matches the small glob dialect workspace declarations use: `*`, `**`, `?`. */
export function matchesGlob(path: string, glob: string): boolean {
  let source = ''
  let index = 0

  while (index < glob.length) {
    const char = glob[index]

    if (char === '*') {
      if (glob.startsWith('**/', index)) {
        source += '(?:[^/]+/)*'
        index += 3
        continue
      }

      if (glob.startsWith('**', index)) {
        source += '.*'
        index += 2
        continue
      }

      source += '[^/]*'
      index += 1
      continue
    }

    if (char === '?') {
      source += '[^/]'
      index += 1
      continue
    }

    source += (char ?? '').replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`)
    index += 1
  }

  return new RegExp(`^${source}$`, 'u').test(path)
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8')
  } catch (err) {
    if (isPathNotFoundError(err)) {
      return undefined
    }

    throw err
  }
}
