import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { ZodError, ZodType } from 'zod'

export interface AtomicWriteOptions {
  ensureDirectory?: boolean
  signal?: AbortSignal
}

export function isPathNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }

  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (err) {
    if (isPathNotFoundError(err)) {
      return false
    }

    throw err
  }
}

export async function copyFileIfExists(
  sourcePath: string,
  targetPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()

  if (!(await pathExists(sourcePath))) {
    return false
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await copyFile(sourcePath, targetPath)

  return true
}

export async function writeTextFileAtomically(
  outputPath: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const { ensureDirectory = false, signal } = options

  signal?.throwIfAborted()

  const outputDir = dirname(outputPath)

  if (ensureDirectory) {
    await mkdir(outputDir, { recursive: true })
  }

  const temporaryPath = join(outputDir, `.${randomUUID()}.tmp`)
  let renameCompleted = false

  try {
    await writeFile(temporaryPath, content, 'utf-8')
    signal?.throwIfAborted()
    await rename(temporaryPath, outputPath)
    renameCompleted = true
  } finally {
    if (!renameCompleted) {
      await unlink(temporaryPath).catch(() => {})
    }
  }
}

export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

export async function readJsonFile<T>(
  filePath: string,
  schema: ZodType<T>,
  label: string,
): Promise<T> {
  const content = await readFile(filePath, 'utf-8')

  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} contains invalid JSON: ${message}`)
  }

  const validationResult = schema.safeParse(parsedJson)

  if (!validationResult.success) {
    throw new Error(`${label} failed validation: ${formatZodIssues(validationResult.error)}`)
  }

  return validationResult.data
}

/**
 * Validates a JSON file against `schema` but returns the object exactly as parsed.
 *
 * Zod rebuilds objects with declared keys first and catchall keys after, which reorders
 * a user's manifest when the result is written back. Use this for files this tool
 * mutates in place; use {@link readJsonFile} for read-only access.
 */
export async function readJsonFilePreservingKeyOrder<T>(
  filePath: string,
  schema: ZodType<T>,
  label: string,
): Promise<T> {
  const content = await readFile(filePath, 'utf-8')

  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} contains invalid JSON: ${message}`)
  }

  const validationResult = schema.safeParse(parsedJson)

  if (!validationResult.success) {
    throw new Error(`${label} failed validation: ${formatZodIssues(validationResult.error)}`)
  }

  // The schemas used here are passthrough/catchall, so the validated value differs from
  // the parsed value only in key order. Returning the parsed object preserves that order.
  return parsedJson as T
}

export async function findClosestPackageJson(startDir: string): Promise<string | undefined> {
  let currentDir = resolve(startDir)

  while (true) {
    const packageJsonPath = join(currentDir, 'package.json')

    if (await pathExists(packageJsonPath)) {
      return packageJsonPath
    }

    const parentDir = dirname(currentDir)

    if (parentDir === currentDir) {
      return undefined
    }

    currentDir = parentDir
  }
}
