import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { OXLINT_DEFAULT_PLUGINS } from './config-merger.js'
import { audit } from './index.js'
import { getRecommendablePlugins, recommendForStack } from './rule-recommender.js'
import type { AuditRequest, ProjectStack } from './types.js'

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

interface ResolvedConfig {
  plugins?: string[]
  categories?: Record<string, string>
  rules?: Record<string, unknown>
}

/** Oxlint's own view of a config after defaults are resolved. */
async function printResolvedConfig(cwd: string, configPath: string): Promise<ResolvedConfig> {
  const { stdout } = await run(['--print-config', '--config', configPath], cwd)

  return JSON.parse(stdout) as ResolvedConfig
}

/** `oxlint.config.ts` imports `defineConfig` from `oxlint`, so the project needs it. */
async function linkOxlintPackage(dir: string): Promise<void> {
  await mkdir(join(dir, 'node_modules'), { recursive: true })
  await symlink(join(process.cwd(), 'node_modules', 'oxlint'), join(dir, 'node_modules', 'oxlint'))
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

/**
 * Oxlint parses `.vue`, `.svelte` and `.astro` and applies its universal rules to the
 * script blocks, but ships a dedicated plugin only for Vue. These fixtures prove the
 * files are genuinely in scope rather than silently skipped, which is the difference
 * between a config that lints a Svelte app and one that quietly lints nothing.
 */
const FRAMEWORK_FIXTURES = [
  {
    name: 'Vue',
    signal: 'vue',
    manifest: { name: 'app', dependencies: { vue: '^3.4.0' } },
    file: 'src/App.vue',
    contents: '<script setup>\ndebugger\n</script>\n<template><div /></template>\n',
    expectsPlugin: 'vue',
  },
  {
    name: 'Svelte',
    signal: 'svelte',
    manifest: { name: 'app', dependencies: { svelte: '^5.0.0' } },
    file: 'src/App.svelte',
    contents: '<script>\ndebugger\n</script>\n<div />\n',
    expectsPlugin: undefined,
  },
  {
    name: 'Astro',
    signal: 'astro',
    manifest: { name: 'app', dependencies: { astro: '^5.0.0' } },
    file: 'src/index.astro',
    contents: '---\ndebugger\n---\n<div />\n',
    expectsPlugin: undefined,
  },
] as const

describe('environments', () => {
  it('lets no-implied-eval see a bare setTimeout once the environment is declared', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      'src/timer.ts': 'setTimeout("alert(1)", 10)\n',
    })

    await audit({ projectDir: dir, write: true })
    const { stdout } = await run(['--config', '.oxlintrc.json', 'src/timer.ts'], dir)

    expect(stdout).toContain('no-implied-eval')
  })
})

describe('framework file types are genuinely linted', () => {
  for (const fixture of FRAMEWORK_FIXTURES) {
    it(`detects ${fixture.name} and produces a config that lints its files`, async () => {
      const dir = await setupProject({
        'package.json': JSON.stringify(fixture.manifest),
        [fixture.file]: fixture.contents,
      })

      const report = await audit({ projectDir: dir, write: true })

      expect(report.stack.signals.map((signal) => signal.id)).toContain(fixture.signal)

      const { stdout, stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)
      const output = `${stdout}${stderr}`

      expect(output).not.toContain('Failed to parse')
      // The `debugger` inside the framework file must actually be reported, which only
      // happens if Oxlint parsed the file rather than skipping it.
      expect(output).toContain('no-debugger')
      expect(output).toContain(fixture.file.split('/').at(-1))
    })

    it(`${fixture.name}: recommends only plugins Oxlint actually ships for it`, async () => {
      const dir = await setupProject({
        'package.json': JSON.stringify(fixture.manifest),
        [fixture.file]: fixture.contents,
      })

      const report = await audit({ projectDir: dir })
      const plugins = report.recommendations
        .filter((entry) => entry.kind === 'plugin')
        .map((entry) => entry.target)
      const capabilities = report.prerequisites.map((entry) => entry.capability.toLowerCase())

      // Vue has a plugin, so it is recommended. Svelte and Astro do not, so the gap is
      // reported as a prerequisite rather than silently producing nothing.
      expect(fixture.expectsPlugin ? plugins : capabilities).toContain(
        fixture.expectsPlugin ?? `${fixture.name.toLowerCase()}-specific rules`,
      )
    })
  }
})

describe('type-aware linting', () => {
  const TYPE_AWARE_PROJECT = {
    'package.json': JSON.stringify({
      name: 'app',
      type: 'module',
      devDependencies: { typescript: '^5.0.0', 'oxlint-tsgolint': '^7.0.2001' },
    }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
    // `await` on a number violates typescript/await-thenable, which needs type information.
    'src/a.ts': 'export async function f() {\n  const n = 1\n  await n\n  return n\n}\n',
  }

  it('enables type-aware rules when oxlint-tsgolint is installed', async () => {
    const dir = await setupProject(TYPE_AWARE_PROJECT)

    const report = await audit({ projectDir: dir, write: true })
    const config = JSON.parse(await readFile(join(dir, '.oxlintrc.json'), 'utf-8')) as {
      options?: { typeAware?: boolean }
      rules?: Record<string, string>
    }

    expect(config.options?.typeAware).toBe(true)
    expect(config.rules?.['typescript/await-thenable']).toBe('error')
    expect(report.prerequisites.map((entry) => entry.capability)).not.toContain(
      'Type-aware linting',
    )
  })

  it('produces a config whose type-aware rules actually fire', async () => {
    const dir = await setupProject(TYPE_AWARE_PROJECT)

    await audit({ projectDir: dir, write: true })
    const { stdout, stderr } = await run(['--config', '.oxlintrc.json', '--type-aware', '.'], dir)
    const output = `${stdout}${stderr}`

    // Proves the engine resolved and the rule ran, not just that the JSON looked right.
    expect(output).not.toContain('Failed to find tsgolint')
    expect(output).toContain('await-thenable')
  })

  it('reports type-aware as a prerequisite instead of configuring it when the engine is absent', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', devDependencies: { typescript: '^5.0.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/a.ts': 'export const a = 1\n',
    })

    const report = await audit({ projectDir: dir, write: true })
    const config = JSON.parse(await readFile(join(dir, '.oxlintrc.json'), 'utf-8')) as {
      options?: { typeAware?: boolean }
      rules?: Record<string, string>
    }

    // Writing typeAware without the engine would make `oxlint --type-aware` fail.
    expect(config.options?.typeAware).toBeUndefined()
    expect(config.rules?.['typescript/await-thenable']).toBeUndefined()

    const prerequisite = report.prerequisites.find(
      (entry) => entry.capability === 'Type-aware linting',
    )
    expect(prerequisite?.install).toBe('pnpm add -D oxlint-tsgolint')
  })

  it('respects an explicit typeAware: false as a decision', async () => {
    const dir = await setupProject({
      ...TYPE_AWARE_PROJECT,
      '.oxlintrc.json': `${JSON.stringify({ options: { typeAware: false } }, null, 2)}\n`,
    })

    const report = await audit({ projectDir: dir, write: true })
    const config = JSON.parse(await readFile(join(dir, '.oxlintrc.json'), 'utf-8')) as {
      options?: { typeAware?: boolean }
    }

    expect(config.options?.typeAware).toBe(false)
    expect(report.explicitlyDisabled.map((entry) => entry.target)).toContain('typeAware')
  })
})

describe('Vue targeted rules', () => {
  it('recommends the Vue rules that are off by default and Oxlint accepts them', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { vue: '^3.4.0' } }),
      'src/App.vue':
        '<script setup lang="ts">\nimport { ref } from "vue"\nconst thing = ref()\n</script>\n<template><div /></template>\n',
    })

    const report = await audit({ projectDir: dir, write: true })
    const rules = report.recommendations
      .filter((entry) => entry.kind === 'rule')
      .map((entry) => entry.target)

    expect(rules).toEqual(
      expect.arrayContaining([
        'vue/no-multiple-slot-args',
        'vue/require-typed-ref',
        'vue/require-prop-types',
      ]),
    )

    const { stdout, stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)
    const output = `${stdout}${stderr}`

    expect(output).not.toContain('Failed to parse')
    // The untyped `ref()` must actually be flagged, proving the rule is live rather than
    // merely present in the JSON.
    expect(output).toContain('require-typed-ref')
  })

  it('does not recommend Vue rules for a project without Vue', async () => {
    const dir = await setupProject(REACT_PROJECT)

    const report = await audit({ projectDir: dir })
    const rules = report.recommendations.map((entry) => entry.target)

    expect(rules.filter((rule) => rule.startsWith('vue/'))).toEqual([])
  })
})

/**
 * A rule-level severity overrides the category that contains the rule. Recommending a rule
 * at `warn` when its category is already on at `error` therefore weakens a check that was
 * active before the run - the one thing the merger promises never to do, and the one case
 * it cannot see, because the category's members are Oxlint's to know. Oxlint's own rule
 * listing is the source of truth for that membership.
 */
describe('recommendations never weaken a rule its category already enables', () => {
  const SEVERITY_RANK = { off: 0, warn: 1, error: 2 } as const

  async function readRuleCategories(): Promise<Map<string, string>> {
    // Every plugin enabled, so the listing covers rules the recommender can reach.
    const dir = await setupProject({
      '.oxlintrc.json': JSON.stringify({
        plugins: getRecommendablePlugins(),
      }),
    })
    const { stdout } = await run(['--rules', '--format=json', '-c', '.oxlintrc.json'], dir)
    const listing = JSON.parse(stdout) as Array<{ scope: string; value: string; category: string }>

    return new Map(
      listing.map(({ scope, value, category }) => [
        // `--rules` spells plugin scopes with underscores where configs use hyphens.
        scope === 'eslint' ? value : `${scope.replaceAll('_', '-')}/${value}`,
        category,
      ]),
    )
  }

  const stack: ProjectStack = {
    projectDir: '/project',
    packageJsonPath: '/project/package.json',
    signals: (
      [
        'typescript',
        'tsconfig',
        'tsgolint',
        'jsx',
        'react',
        'react-dom',
        'nextjs',
        'vue',
        'vitest',
        'jest',
        'node',
        'jsdoc',
        'esm',
      ] as const
    ).map((id) => ({ id, evidence: [{ kind: 'dependency' as const, value: id }] })),
    sourceExtensions: ['.ts', '.tsx', '.vue'],
    filesScanned: 3,
    scanTruncated: false,
  }

  const requests: AuditRequest[] = [
    ...(['basic', 'recommended', 'strict', 'paranoid'] as const).map((level) => ({
      level,
      domains: [],
      maximal: false,
      forcedSignals: [],
    })),
    { level: 'paranoid', domains: [], maximal: true, forcedSignals: [] },
  ]

  it.each(requests)('holds at %o', async (request) => {
    const categories = await readRuleCategories()
    // The listing has to cover the base plugins too, or their targeted rules go unchecked.
    expect(categories.get('unicorn/prefer-set-has')).toBe('perf')
    expect(categories.get('oxc/no-accumulating-spread')).toBe('perf')
    const recommendations = recommendForStack(stack, request)
    const categorySeverity = new Map<string, keyof typeof SEVERITY_RANK>()

    for (const entry of recommendations) {
      if (entry.kind === 'category' && entry.severity) {
        categorySeverity.set(entry.target, entry.severity)
      }
    }

    const weakened = recommendations
      .filter((entry) => entry.kind === 'rule' && entry.severity !== undefined)
      // An `off` is the deliberate exception: recommended only where evidence proves the
      // rule cannot apply, and covered by its own test below.
      .filter((entry) => entry.severity !== 'off')
      .filter((entry) => {
        const category = categories.get(entry.target)
        const enabledAt = category === undefined ? undefined : categorySeverity.get(category)

        return (
          enabledAt !== undefined &&
          SEVERITY_RANK[entry.severity ?? 'off'] < SEVERITY_RANK[enabledAt]
        )
      })
      .map((entry) => `${entry.target}: ${entry.severity} (${categories.get(entry.target)})`)

    expect(weakened).toEqual([])
  })
})

/**
 * `suspicious` carries `react/react-in-jsx-scope`, which under the automatic JSX runtime
 * reports every component file for a binding that is never used. The recommended config
 * for a React 17+ project has to run clean on a plain component, and a project that
 * re-enabled the rule keeps it.
 */
describe('the automatic JSX runtime', () => {
  const COMPONENT = 'export function App() {\n  return <div />\n}\n'

  it('keeps react-in-jsx-scope quiet on a React 19 project', async () => {
    const dir = await setupProject({ ...REACT_PROJECT, 'src/App.tsx': COMPONENT })

    const report = await audit({ projectDir: dir, write: true })
    const { stdout, stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)

    expect(report.recommendations.map(({ target }) => target)).toContain('react/react-in-jsx-scope')
    expect(`${stdout}${stderr}`).not.toContain('react-in-jsx-scope')
  })

  it('still reports it on a React 16 project, whose runtime is classic', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^16.14.0' } }),
      'src/App.tsx': COMPONENT,
    })

    const report = await audit({ projectDir: dir, write: true })
    const { stdout, stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)

    expect(report.recommendations.map(({ target }) => target)).not.toContain(
      'react/react-in-jsx-scope',
    )
    expect(`${stdout}${stderr}`).toContain('react-in-jsx-scope')
  })

  it('leaves a project that re-enabled the rule alone', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      'src/App.tsx': COMPONENT,
      '.oxlintrc.json': `${JSON.stringify({ rules: { 'react/react-in-jsx-scope': 'error' } })}\n`,
    })

    await audit({ projectDir: dir, write: true })
    const written = JSON.parse(await readFile(join(dir, '.oxlintrc.json'), 'utf-8')) as {
      rules: Record<string, string>
    }

    expect(written.rules['react/react-in-jsx-scope']).toBe('error')
  })
})

/**
 * Every level has to produce a config Oxlint accepts, not just the default one.
 *
 * The higher levels enable most of tsgolint's rule set and reach categories the default
 * run never touches. A level that emits something Oxlint rejects at load time would leave
 * the project with no working lint at all.
 */
describe('every level produces a config Oxlint accepts', () => {
  const levels = ['basic', 'recommended', 'strict', 'paranoid'] as const

  for (const level of levels) {
    it(`loads and runs at --${level}`, async () => {
      const dir = await setupProject(REACT_PROJECT)
      const report = await audit({ projectDir: dir, level, write: true })

      expect(report.success).toBe(true)

      // `--print-config` reports resolved severities in Oxlint's own vocabulary, where
      // `error` comes back as `deny`.
      const resolved = await printResolvedConfig(dir, join(dir, '.oxlintrc.json'))
      expect(resolved.categories?.correctness).toBe('deny')

      // A rejected config prints a parse failure rather than diagnostics.
      const { stderr } = await run(['--config', '.oxlintrc.json', '.'], dir)
      expect(stderr).not.toMatch(/Failed to parse|invalid|unknown rule/iu)
    })
  }

  it('reaches strictly more categories as the level climbs', async () => {
    const counts: number[] = []

    for (const level of levels) {
      const dir = await setupProject(REACT_PROJECT)
      await audit({ projectDir: dir, level, write: true })
      const resolved = await printResolvedConfig(dir, join(dir, '.oxlintrc.json'))
      counts.push(Object.keys(resolved.categories ?? {}).length)
    }

    expect(counts).toEqual([...counts].sort((left, right) => left - right))
    expect(counts.at(-1)).toBeGreaterThan(counts[0] ?? 0)
  })

  it('never enables the nursery category, whose rules are unstable upstream', async () => {
    const dir = await setupProject(REACT_PROJECT)
    await audit({ projectDir: dir, level: 'paranoid', maximal: true, write: true })

    const resolved = await printResolvedConfig(dir, join(dir, '.oxlintrc.json'))
    expect(resolved.categories?.nursery).toBeUndefined()
  })
})

describe('the formatter config', () => {
  it('writes an oxfmt config Oxlint-adjacent tooling can read back', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      '.prettierrc': JSON.stringify({ semi: false, singleQuote: true, printWidth: 100 }),
    })
    const report = await audit({ projectDir: dir, format: true, write: true })

    expect(report.format?.written).toBe(true)
    expect(report.format?.carriedFrom).toBe('prettier')

    const written = JSON.parse(await readFile(join(dir, '.oxfmtrc.jsonc'), 'utf-8')) as Record<
      string,
      unknown
    >

    expect(written.semi).toBe(false)
    expect(written.singleQuote).toBe(true)
    expect(written.printWidth).toBe(100)
  })

  it('writes a formatter config by default, since it is part of the toolchain', async () => {
    const dir = await setupProject(REACT_PROJECT)
    const report = await audit({ projectDir: dir, write: true })

    expect(report.format?.written).toBe(true)
  })

  it('writes nothing when --no-format turned it off', async () => {
    const dir = await setupProject(REACT_PROJECT)
    const report = await audit({ projectDir: dir, format: false, write: true })

    expect(report.format).toBeUndefined()
  })
})

/**
 * Oxlint allows one config per directory and refuses to start when it finds two:
 * "Only one of `.oxlintrc.json` and `oxlint.config.ts` is allowed per directory."
 * A module config is therefore the config to update, never one to write a JSON file beside.
 * It is rewritten only while it is a plain object; code in it is the user's to keep.
 */
describe('projects configured with a module config', () => {
  it('updates the oxlint.config.ts it finds rather than writing a competing .oxlintrc.json', async () => {
    const dir = await setupProject({
      ...REACT_PROJECT,
      'oxlint.config.ts': "export default { rules: { 'no-console': 'error' } }\n",
    })
    await linkOxlintPackage(dir)

    const report = await audit({ projectDir: dir, write: true })
    const resolved = await printResolvedConfig(dir, 'oxlint.config.ts')

    expect(report.blockers).toEqual([])
    expect(report.config.written).toBe(true)
    await expect(readFile(join(dir, '.oxlintrc.json'), 'utf-8')).rejects.toThrow(/ENOENT/u)
    expect(resolved.plugins).toContain('react')
    expect(resolved.rules?.['no-console']).toBe('deny')
  })

  it('leaves a module config with code in it alone, and still reports', async () => {
    const original =
      "export default { rules: { 'no-console': process.env.CI ? 'error' : 'warn' } }\n"
    const dir = await setupProject({ ...REACT_PROJECT, 'oxlint.config.ts': original })

    const report = await audit({ projectDir: dir, write: true })

    expect(report.blockers.join('\n')).toMatch(/oxlint\.config\.ts/u)
    expect(report.recommendations.length).toBeGreaterThan(0)
    expect(report.config.written).toBe(false)
    expect(await readFile(join(dir, 'oxlint.config.ts'), 'utf-8')).toBe(original)
    await expect(readFile(join(dir, '.oxlintrc.json'), 'utf-8')).rejects.toThrow(/ENOENT/u)
  })

  it('refuses to write a .oxlintrc.json named explicitly beside a module config', async () => {
    const dir = await setupProject({ ...REACT_PROJECT, 'oxlint.config.ts': 'export default {}\n' })

    const report = await audit({ projectDir: dir, configPath: '.oxlintrc.json', write: true })

    expect(report.blockers.join('\n')).toMatch(/oxlint\.config\.ts/u)
    await expect(readFile(join(dir, '.oxlintrc.json'), 'utf-8')).rejects.toThrow(/ENOENT/u)
  })

  it('will not create an oxlint.config.ts whose defineConfig import cannot resolve', async () => {
    const dir = await setupProject(REACT_PROJECT)

    const report = await audit({ projectDir: dir, tsConfig: true, write: true })

    expect(report.blockers.join('\n')).toMatch(/oxlint, which is not installed/u)
    await expect(readFile(join(dir, 'oxlint.config.ts'), 'utf-8')).rejects.toThrow(/ENOENT/u)
  })

  it('creates an oxlint.config.ts on request that Oxlint loads and a second run finds complete', async () => {
    const dir = await setupProject(REACT_PROJECT)
    await linkOxlintPackage(dir)

    const report = await audit({ projectDir: dir, tsConfig: true, write: true })
    const resolved = await printResolvedConfig(dir, 'oxlint.config.ts')
    const second = await audit({ projectDir: dir, tsConfig: true, write: true })

    expect(report.config.path).toBe(join(dir, 'oxlint.config.ts'))
    expect(report.config.written).toBe(true)
    for (const plugin of report.recommendations
      .filter((entry) => entry.kind === 'plugin')
      .map((entry) => entry.target)) {
      expect(resolved.plugins).toContain(plugin)
    }
    expect(second.blockers).toEqual([])
    expect(second.config.changed).toBe(false)
  })
})
