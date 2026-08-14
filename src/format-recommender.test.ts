import { describe, expect, it } from 'vitest'

import { mergeFormatterConfig } from './format-config-loader.js'
import { fromBiome, fromPrettier, recommendFormatterConfig } from './format-recommender.js'
import { withForcedSignals } from './stack-detector.js'
import type { ProjectStack } from './types.js'

const STACK: ProjectStack = {
  projectDir: '/project',
  packageJsonPath: '/project/package.json',
  signals: [],
  sourceExtensions: ['.ts'],
  filesScanned: 1,
  scanTruncated: false,
}

describe('carrying settings across from Prettier', () => {
  it('keeps the settings that mean the same thing in oxfmt', () => {
    const settings = fromPrettier({ semi: false, singleQuote: true, printWidth: 100, tabWidth: 2 })

    expect(settings).toEqual({ semi: false, singleQuote: true, printWidth: 100, tabWidth: 2 })
  })

  it('drops keys oxfmt has no equivalent for rather than guessing one', () => {
    const settings = fromPrettier({ semi: true, plugins: ['prettier-plugin-tailwindcss'] })

    expect(settings).toEqual({ semi: true })
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

  it('never writes an ignore list, which would quietly narrow what gets formatted', () => {
    expect(recommendFormatterConfig(STACK, undefined).ignorePatterns).toBeUndefined()
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
