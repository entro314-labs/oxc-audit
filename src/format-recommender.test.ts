import { describe, expect, it } from 'vitest'

import { mergeFormatterConfig } from './format-config-loader.js'
import {
  fromBiome,
  fromPrettier,
  prettierLeftovers,
  recommendFormatterConfig,
} from './format-recommender.js'
import { withForcedSignals } from './stack-detector.js'
import type { ProjectStack } from './types.js'

const STACK: ProjectStack = {
  projectDir: '/project',
  packageJsonPath: '/project/package.json',
  signals: [],
  sourceExtensions: ['.ts'],
  filesScanned: 1,
  scanTruncated: false,
  minifiedFiles: [],
}

describe('carrying settings across from Prettier', () => {
  it('keeps the settings that mean the same thing in oxfmt', () => {
    const settings = fromPrettier({ semi: false, singleQuote: true, printWidth: 100, tabWidth: 2 })

    expect(settings).toEqual({ semi: false, singleQuote: true, printWidth: 100, tabWidth: 2 })
  })

  it('drops keys oxfmt has no equivalent for rather than guessing one', () => {
    const config = {
      semi: true,
      plugins: ['prettier-plugin-organize-imports'],
      requirePragma: true,
    }

    expect(fromPrettier(config)).toEqual({ semi: true })
    expect(prettierLeftovers(config)).toEqual([
      'requirePragma',
      'plugin prettier-plugin-organize-imports',
    ])
  })

  it('turns the Tailwind plugin into the sorting oxfmt implements, options included', () => {
    expect(fromPrettier({ plugins: ['prettier-plugin-tailwindcss'] })).toEqual({
      sortTailwindcss: true,
    })
    expect(
      fromPrettier({
        plugins: ['prettier-plugin-tailwindcss'],
        tailwindFunctions: ['cn', 'cva'],
        tailwindStylesheet: './src/app.css',
      }),
    ).toEqual({ sortTailwindcss: { functions: ['cn', 'cva'], stylesheet: './src/app.css' } })
  })

  it('leaves endOfLine auto behind, which oxfmt rejects along with the whole file', () => {
    const config = { endOfLine: 'auto', semi: false }

    expect(fromPrettier(config)).toEqual({ semi: false })
    expect(prettierLeftovers(config)).toEqual(['endOfLine: "auto"'])
    expect(fromBiome({ formatter: { lineEnding: 'auto' } })).toEqual({})
  })

  it('carries a falsy value rather than treating it as absent', () => {
    expect(fromPrettier({ semi: false, useTabs: false })).toEqual({ semi: false, useTabs: false })
  })
})

describe('carrying settings across from Biome', () => {
  it('translates the settings Biome spells differently', () => {
    const settings = fromBiome({
      formatter: { indentStyle: 'tab', indentWidth: 4, lineWidth: 120 },
      javascript: { formatter: { quoteStyle: 'single', semicolons: 'asNeeded' } },
    })

    expect(settings).toEqual({
      useTabs: true,
      tabWidth: 4,
      printWidth: 120,
      singleQuote: true,
      semi: false,
    })
  })

  it('reads space indentation as useTabs false rather than omitting it', () => {
    expect(fromBiome({ formatter: { indentStyle: 'space' } })).toEqual({ useTabs: false })
  })

  // oxfmt rejects a config carrying Biome's spelling outright ("unknown variant
  // `asNeeded`"), so each enum has to arrive in oxfmt's vocabulary or not at all.
  it('respells the enum values oxfmt names differently', () => {
    expect(
      fromBiome({
        javascript: { formatter: { arrowParentheses: 'asNeeded', quoteProperties: 'asNeeded' } },
      }),
    ).toEqual({ arrowParens: 'avoid', quoteProps: 'as-needed' })
    expect(
      fromBiome({
        javascript: { formatter: { arrowParentheses: 'always', quoteProperties: 'preserve' } },
      }),
    ).toEqual({ arrowParens: 'always', quoteProps: 'preserve' })
  })

  it('leaves an enum value it cannot translate behind rather than copying it', () => {
    expect(fromBiome({ javascript: { formatter: { arrowParentheses: 'sometimes' } } })).toEqual({})
  })

  it('returns nothing for a Biome config with no formatter section', () => {
    expect(fromBiome({})).toEqual({})
  })
})

describe('the recommended formatter config', () => {
  it('lets an existing formatter decide the shared settings', () => {
    const config = recommendFormatterConfig(STACK, {
      source: 'prettier',
      settings: { semi: false, printWidth: 100 },
    })

    expect(config.semi).toBe(false)
    expect(config.printWidth).toBe(100)
  })

  it('adds import sorting, which no Prettier setup was already doing', () => {
    const config = recommendFormatterConfig(STACK, undefined)

    expect(config.sortImports).toBeDefined()
  })

  it('writes an ignore list only for minified files the scan found', () => {
    expect(recommendFormatterConfig(STACK, undefined).ignorePatterns).toBeUndefined()
    expect(
      recommendFormatterConfig(
        { ...STACK, minifiedFiles: ['public/worker.js', 'vendor/a.min.js'] },
        undefined,
      ).ignorePatterns,
    ).toEqual(['**/*.min.js', 'public/worker.js'])
  })
})

describe('merging into an existing oxfmt config', () => {
  it('adds only the keys that are absent', () => {
    const { config, added } = mergeFormatterConfig({ semi: true }, { semi: false, printWidth: 100 })

    expect(config.semi).toBe(true)
    expect(added).toEqual(['printWidth'])
  })

  it('treats a second run as a no-op', () => {
    const first = mergeFormatterConfig({}, { semi: false, printWidth: 100 })
    const second = mergeFormatterConfig(first.config, { semi: false, printWidth: 100 })

    expect(second.added).toEqual([])
    expect(second.config).toEqual(first.config)
  })

  it('never drops a key it does not understand', () => {
    const { config } = mergeFormatterConfig({ somePluginOption: { nested: true } }, { semi: false })

    expect(config.somePluginOption).toEqual({ nested: true })
  })
})

describe('signals asserted on the command line', () => {
  it('adds a signal the project does not declare, marked as flag evidence', () => {
    const forced = withForcedSignals(STACK, ['vue'])

    expect(forced.signals.map(({ id }) => id)).toEqual(['vue'])
    expect(forced.signals[0]?.evidence).toEqual([{ kind: 'flag', value: '--vue' }])
  })

  it('records the assertion beside the detected fact rather than replacing it', () => {
    const detected: ProjectStack = {
      ...STACK,
      signals: [{ id: 'react', evidence: [{ kind: 'dependency', value: 'react' }] }],
    }
    const forced = withForcedSignals(detected, ['react'])

    expect(forced.signals[0]?.evidence).toEqual([
      { kind: 'dependency', value: 'react' },
      { kind: 'flag', value: '--react' },
    ])
  })

  it('leaves the stack untouched when nothing was forced', () => {
    expect(withForcedSignals(STACK, [])).toBe(STACK)
  })

  it('does not mutate the stack it was given', () => {
    const detected: ProjectStack = {
      ...STACK,
      signals: [{ id: 'react', evidence: [{ kind: 'dependency', value: 'react' }] }],
    }
    const snapshot = structuredClone(detected)

    withForcedSignals(detected, ['react', 'vue'])

    expect(detected).toEqual(snapshot)
  })
})

describe('framework files', () => {
  const svelteStack = (evidenceKind: 'dependency' | 'source-extension'): ProjectStack => ({
    ...STACK,
    sourceExtensions: ['.svelte', '.ts'],
    signals: [{ id: 'svelte', evidence: [{ kind: evidenceKind, value: 'svelte' }] }],
  })

  it('turns .svelte formatting on when the svelte compiler oxfmt loads is installed', () => {
    expect(recommendFormatterConfig(svelteStack('dependency'), undefined).svelte).toBe(true)
  })

  it('leaves it off without the compiler, where every format run would fail', () => {
    expect(
      recommendFormatterConfig(svelteStack('source-extension'), undefined).svelte,
    ).toBeUndefined()
    expect(
      recommendFormatterConfig(svelteStack('source-extension'), {
        source: 'prettier',
        settings: fromPrettier({ plugins: ['prettier-plugin-svelte'] }),
      }).svelte,
    ).toBeUndefined()
  })

  it('keeps it off for a project whose formatter never formatted those files', () => {
    expect(
      recommendFormatterConfig(svelteStack('dependency'), { source: 'biome', settings: {} }).svelte,
    ).toBeUndefined()
    expect(
      recommendFormatterConfig(svelteStack('dependency'), {
        source: 'prettier',
        settings: fromPrettier({ plugins: ['prettier-plugin-svelte'] }),
      }).svelte,
    ).toBe(true)
  })
})
