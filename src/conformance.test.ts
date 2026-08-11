import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { OXLINT_DEFAULT_PLUGINS } from './config-merger.js'
import { audit } from './index.js'

const execFileAsync = promisify(execFile)
const OXLINT_BIN = join(process.cwd(), 'node_modules', '.bin', 'oxlint')

/**
 * Conformance against the real Oxlint binary.
 *
 * Unit tests can only prove the tool emits the JSON it meant to emit. A config can be
 * perfectly shaped and still be rejected at load time, or silently disable plugins that
 * were previously on. These tests run Oxlint itself so those failures surface here.
 */

async function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(OXLINT_BIN, args, { cwd })
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

/** Oxlint's own view of a config after defaults are resolved. */
async function printResolvedConfig(
  cwd: string,
  configPath: string,
): Promise<{ plugins?: string[]; categories?: Record<string, string> }> {
  const { stdout } = await run(['--print-config', '--config', configPath], cwd)

  return JSON.parse(stdout) as { plugins?: string[]; categories?: Record<string, string> }
}

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-conformance-'))

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }

  return dir
}

const REACT_PROJECT = {
  'package.json': JSON.stringify({
    name: 'app',
    type: 'module',
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' },
  }),
  'src/App.tsx': 'export default function App() { return null }\n',
}

describe('generated configs load in the real Oxlint', () => {
  it('writes a config Oxlint parses without error', async () => {
    const dir = await setupProject(REACT_PROJECT)

    await audit({ projectDir: dir, write: true })
    const { stdout, stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)

    expect(stderr).not.toContain('Failed to parse')
    expect(stdout).not.toContain('invalid config file')
  })

  it('actually enables the plugins it claims to enable', async () => {
    const dir = await setupProject(REACT_PROJECT)

    const report = await audit({ projectDir: dir, write: true })
    const resolved = await printResolvedConfig(dir, '.oxlintrc.json')
    const claimed = report.recommendations
      .filter((entry) => entry.kind === 'plugin')
      .map((entry) => entry.target)

    for (const plugin of claimed) {
      expect(resolved.plugins).toContain(plugin)
    }
  })

  it('never disables a plugin that was active before the run', async () => {
    // A config with no `plugins` key has Oxlint's base set active. Writing the field
    // overwrites that set, so the base plugins must survive the round trip.
    const dir = await setupProject({
      ...REACT_PROJECT,
      '.oxlintrc.json': `${JSON.stringify({ rules: { 'no-eval': 'warn' } }, null, 2)}\n`,
    })

    const before = await printResolvedConfig(dir, '.oxlintrc.json')
    await audit({ projectDir: dir, write: true })
    const after = await printResolvedConfig(dir, '.oxlintrc.json')

    for (const plugin of before.plugins ?? OXLINT_DEFAULT_PLUGINS) {
      expect(after.plugins).toContain(plugin)
    }
  })

  it('produces a config whose recommended rules Oxlint recognises', async () => {
    const dir = await setupProject(REACT_PROJECT)

    await audit({ projectDir: dir, write: true })
    const { stdout, stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)

    // Oxlint reports unknown rule names rather than failing outright, so an unrecognised
    // rule would show up here as a diagnostic about the config rather than the code.
    expect(`${stdout}${stderr}`).not.toContain('Unknown rule')
    expect(`${stdout}${stderr}`).not.toContain('unknown rule')
  })

  it('leaves a hand-written config loadable after merging into it', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      '.oxlintrc.json': `${JSON.stringify(
        {
          $schema: './node_modules/oxlint/configuration_schema.json',
          plugins: ['vue'],
          categories: { correctness: 'error' },
          rules: { 'no-eval': 'off' },
          ignorePatterns: ['dist/**'],
        },
        null,
        2,
      )}\n`,
    })

    await audit({ projectDir: dir, write: true })
    const { stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)
    const merged = JSON.parse(await readFile(join(dir, '.oxlintrc.json'), 'utf-8')) as {
      plugins: string[]
      rules: Record<string, string>
      ignorePatterns: string[]
    }

    expect(stderr).not.toContain('Failed to parse')
    // Everything the author wrote survives.
    expect(merged.plugins).toContain('vue')
    expect(merged.rules['no-eval']).toBe('off')
    expect(merged.ignorePatterns).toEqual(['dist/**'])
  })
})
