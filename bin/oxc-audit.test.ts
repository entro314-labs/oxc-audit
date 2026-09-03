import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isProcessEntrypoint, runCli } from './oxc-audit.js'

/**
 * The entrypoint guard decides whether the CLI runs at all. When it is wrong the binary
 * exits 0 having produced nothing, which no other test can catch: every other test calls
 * `runCli` directly and never crosses the guard.
 */

interface Entrypoint {
  /** The file Node resolves `import.meta.url` to. */
  modulePath: string
  /** The `node_modules/.bin` symlink a package manager would create for it. */
  linkPath: string
}

async function setupEntrypoint(): Promise<Entrypoint> {
  const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-entrypoint-'))
  const modulePath = join(dir, 'oxc-audit.mjs')
  const linkPath = join(dir, 'oxc-audit')

  await writeFile(modulePath, '')
  await symlink(modulePath, linkPath)

  return { modulePath, linkPath }
}

describe('isProcessEntrypoint', () => {
  it('runs when the module is invoked by its real path', async () => {
    const { modulePath } = await setupEntrypoint()

    expect(await isProcessEntrypoint(modulePath, pathToFileURL(modulePath).href)).toBe(true)
  })

  it('runs when the module is invoked through a bin symlink', async () => {
    // `npx oxc-audit` and `node_modules/.bin/oxc-audit` both take this path: argv[1] is
    // the link, import.meta.url is the resolved target.
    const { modulePath, linkPath } = await setupEntrypoint()

    expect(await isProcessEntrypoint(linkPath, pathToFileURL(modulePath).href)).toBe(true)
  })

  it('does not run when a different module is the entrypoint', async () => {
    const { modulePath } = await setupEntrypoint()
    const other = await setupEntrypoint()

    expect(await isProcessEntrypoint(other.modulePath, pathToFileURL(modulePath).href)).toBe(false)
    expect(await isProcessEntrypoint(other.linkPath, pathToFileURL(modulePath).href)).toBe(false)
  })

  it('does not run when the module is imported rather than executed', async () => {
    const { modulePath } = await setupEntrypoint()

    expect(await isProcessEntrypoint(undefined, pathToFileURL(modulePath).href)).toBe(false)
  })

  it('does not run when the entrypoint is not a path on disk', async () => {
    const { modulePath } = await setupEntrypoint()

    expect(await isProcessEntrypoint('[eval]', pathToFileURL(modulePath).href)).toBe(false)
  })
})

describe('help output', () => {
  it('names the binary rather than the scoped package', async () => {
    // The name comes from `package.json`, which is scoped; the bin it installs is not.
    // Printing the scope would tell the reader to type a command that does not exist.
    let out = ''
    const stdout = {
      write: (chunk: string) => {
        out += chunk
        return true
      },
    }

    await runCli(['--help'], { stdout, stderr: stdout })

    expect(out).toContain('Usage: oxc-audit [options]')
    expect(out).not.toContain('@entro314labs')
  })
})
