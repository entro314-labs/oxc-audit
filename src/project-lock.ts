import { readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { isPathNotFoundError } from './fs-utils.js'
import type { Reporter } from './types.js'

const LOCK_FILE_NAME = '.oxc-audit.lock'
/** Locks older than this are treated as abandoned by a crashed process. */
const STALE_LOCK_MS = 5 * 60 * 1000

export interface ProjectLock {
  release(): Promise<void>
}

export class ProjectLockedError extends Error {}

interface LockRecord {
  pid: number
  startedAt: number
}

/**
 * Takes an exclusive, project-scoped lock for the duration of a write.
 *
 * Snapshot, write and restore are not atomic across processes: two concurrent runs can
 * interleave their writes, and a rollback in one can restore a file the other just wrote.
 * The lock serializes them.
 */
export async function acquireProjectLock(
  projectDir: string,
  reporter: Reporter,
  now: number = Date.now(),
): Promise<ProjectLock> {
  const lockPath = resolve(projectDir, LOCK_FILE_NAME)
  const existing = await readLockRecord(lockPath)

  if (existing && !isStale(existing, now) && isProcessAlive(existing.pid)) {
    throw new ProjectLockedError(
      `Another oxc-audit run is in progress in ${projectDir} (pid ${existing.pid}). Wait for it to finish, or remove ${lockPath} if that process is gone.`,
    )
  }

  if (existing) {
    reporter.warn(`Reclaiming stale audit lock left by pid ${existing.pid} at ${lockPath}.`)
  }

  const record: LockRecord = { pid: process.pid, startedAt: now }
  // `wx` fails if another process won the race between the read above and this write.
  try {
    await writeFile(lockPath, `${JSON.stringify(record)}\n`, { encoding: 'utf-8', flag: 'wx' })
  } catch (err) {
    if (existing) {
      // Reclaiming a stale lock legitimately overwrites the abandoned file.
      await writeFile(lockPath, `${JSON.stringify(record)}\n`, 'utf-8')
    } else {
      throw new ProjectLockedError(
        `Could not acquire the audit lock at ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return {
    async release() {
      const current = await readLockRecord(lockPath)

      // Only drop the lock if it is still ours; a reclaimed lock belongs to someone else.
      if (current?.pid === record.pid && current.startedAt === record.startedAt) {
        await unlink(lockPath).catch((err: unknown) => {
          if (!isPathNotFoundError(err)) {
            throw err
          }
        })
      }
    },
  }
}

async function readLockRecord(lockPath: string): Promise<LockRecord | undefined> {
  let content: string

  try {
    content = await readFile(lockPath, 'utf-8')
  } catch (err) {
    if (isPathNotFoundError(err)) {
      return undefined
    }

    throw err
  }

  try {
    const parsed: unknown = JSON.parse(content)

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      'startedAt' in parsed &&
      typeof parsed.pid === 'number' &&
      typeof parsed.startedAt === 'number'
    ) {
      return { pid: parsed.pid, startedAt: parsed.startedAt }
    }
  } catch {
    // An unreadable lock file is treated as abandoned.
  }

  return { pid: -1, startedAt: 0 }
}

function isStale(record: LockRecord, now: number): boolean {
  return now - record.startedAt > STALE_LOCK_MS
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0 || pid === process.pid) {
    return false
  }

  try {
    // Signal 0 performs the permission/existence check without delivering a signal.
    process.kill(pid, 0)
    return true
  } catch (err) {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === 'EPERM'
  }
}
