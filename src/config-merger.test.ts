import { describe, expect, it } from 'vitest'

import { mergeRecommendations, OXLINT_DEFAULT_PLUGINS, toSeverity } from './config-merger.js'
import type { OxlintConfig, Recommendation } from './types.js'

function rule(target: string, severity: 'off' | 'warn' | 'error'): Recommendation {
  return { kind: 'rule', target, severity, reason: 'test', triggeredBy: [] }
}

function plugin(target: string): Recommendation {
  return { kind: 'plugin', target, reason: 'test', triggeredBy: [] }
}

function category(target: string, severity: 'off' | 'warn' | 'error'): Recommendation {
  return { kind: 'category', target, severity, reason: 'test', triggeredBy: [] }
}

function jsPlugin(target: string, specifier?: string): Recommendation {
  return { kind: 'js-plugin', target, specifier, reason: 'test', triggeredBy: [] }
}

describe('mergeRecommendations - js plugins', () => {
  it('adds a jsPlugins entry with the name and specifier', () => {
    const { config, applied } = mergeRecommendations({}, [
      jsPlugin('data-layer', './node_modules/oxlint-audit-plugins/src/data-layer/index.ts'),
    ])

    expect(config.jsPlugins).toEqual([
      {
        name: 'data-layer',
        specifier: './node_modules/oxlint-audit-plugins/src/data-layer/index.ts',
      },
    ])
    expect(applied).toHaveLength(1)
  })

  it('keeps existing entries when adding one', () => {
    const { config } = mergeRecommendations({ jsPlugins: ['./local/plugin.ts'] }, [
      jsPlugin('slop-stop', './node_modules/oxlint-audit-plugins/src/slop-stop/index.ts'),
    ])

    expect(config.jsPlugins).toHaveLength(2)
    expect(config.jsPlugins?.[0]).toBe('./local/plugin.ts')
  })

  it('does not re-add a plugin already registered in object form', () => {
    const { config, applied, alreadySatisfied } = mergeRecommendations(
      { jsPlugins: [{ name: 'data-layer', specifier: './tools/oxlint/data-layer/index.ts' }] },
      [jsPlugin('data-layer', './node_modules/oxlint-audit-plugins/src/data-layer/index.ts')],
    )

    // The project's own path wins; a second entry for the same plugin would be a conflict.
    expect(config.jsPlugins).toHaveLength(1)
    expect(applied).toEqual([])
    expect(alreadySatisfied).toHaveLength(1)
  })

  it('recognises a plugin already registered in bare-string form', () => {
    const { config, alreadySatisfied } = mergeRecommendations(
      { jsPlugins: ['./tools/oxlint/audit-plugins/next-react/index.ts'] },
      [jsPlugin('next-react', './node_modules/oxlint-audit-plugins/src/next-react/index.ts')],
    )

    expect(config.jsPlugins).toHaveLength(1)
    expect(alreadySatisfied).toHaveLength(1)
  })

  it('writes nothing when no specifier is supplied', () => {
    const { config, applied } = mergeRecommendations({}, [jsPlugin('data-layer')])

    expect(config.jsPlugins).toBeUndefined()
    expect(applied).toEqual([])
  })
})

describe('mergeRecommendations - never weakens', () => {
  it('leaves a stricter existing rule severity alone', () => {
    const { config, applied, alreadySatisfied } = mergeRecommendations(
      { rules: { 'no-eval': 'error' } },
      [rule('no-eval', 'warn')],
    )

    expect(config.rules?.['no-eval']).toBe('error')
    expect(applied).toEqual([])
    expect(alreadySatisfied).toHaveLength(1)
  })

  it('raises a weaker existing rule severity', () => {
    const { config, applied } = mergeRecommendations({ rules: { 'no-eval': 'warn' } }, [
      rule('no-eval', 'error'),
    ])

    expect(config.rules?.['no-eval']).toBe('error')
    expect(applied).toHaveLength(1)
  })

  it('preserves rule options when raising severity', () => {
    const { config } = mergeRecommendations(
      { rules: { 'import/no-cycle': ['warn', { maxDepth: 3 }] } },
      [rule('import/no-cycle', 'error')],
    )

    expect(config.rules?.['import/no-cycle']).toEqual(['error', { maxDepth: 3 }])
  })

  it('treats an explicit off as a decision and never overrides it', () => {
    const { config, applied, explicitlyDisabled } = mergeRecommendations(
      { rules: { 'no-eval': 'off' }, categories: { correctness: 'off' } },
      [rule('no-eval', 'error'), category('correctness', 'error')],
    )

    expect(config.rules?.['no-eval']).toBe('off')
    expect(config.categories?.correctness).toBe('off')
    expect(applied).toEqual([])
    expect(explicitlyDisabled).toHaveLength(2)
  })

  it('never drops fields it does not understand', () => {
    const existing = {
      $schema: './node_modules/oxlint/configuration_schema.json',
      ignorePatterns: ['dist/**'],
      overrides: [{ files: ['*.test.ts'], rules: { 'no-console': 'off' as const } }],
      settings: { react: { version: '18' } },
      env: { browser: true },
      someFutureField: { nested: true },
    } as unknown as OxlintConfig

    const { config } = mergeRecommendations(existing, [rule('no-eval', 'error'), plugin('react')])

    expect(config.$schema).toBe(existing.$schema)
    expect(config.ignorePatterns).toEqual(['dist/**'])
    expect(config.overrides).toEqual(existing.overrides)
    expect(config.settings).toEqual(existing.settings)
    expect(config.env).toEqual({ browser: true })
    expect((config as Record<string, unknown>).someFutureField).toEqual({ nested: true })
  })

  it('does not mutate the config it was given', () => {
    const existing: OxlintConfig = { rules: { 'no-eval': 'warn' }, plugins: ['react'] }
    const snapshot = structuredClone(existing)

    mergeRecommendations(existing, [rule('no-eval', 'error'), plugin('vitest')])

    expect(existing).toEqual(snapshot)
  })
})

describe('mergeRecommendations - plugin handling', () => {
  it('carries the base plugin set when first writing the field', () => {
    // Oxlint's schema: "Setting the `plugins` field will overwrite the base set."
    const { config } = mergeRecommendations({}, [plugin('react')])

    for (const defaultPlugin of OXLINT_DEFAULT_PLUGINS) {
      expect(config.plugins).toContain(defaultPlugin)
    }
    expect(config.plugins).toContain('react')
  })

  it('treats an absent plugins field as the base set already being enabled', () => {
    const { applied, alreadySatisfied } = mergeRecommendations({}, [plugin('typescript')])

    expect(applied).toEqual([])
    expect(alreadySatisfied).toHaveLength(1)
  })

  it('keeps plugins the user enabled that the recommender never mentions', () => {
    const { config } = mergeRecommendations({ plugins: ['jsdoc', 'promise'] }, [plugin('react')])

    expect(config.plugins).toEqual(expect.arrayContaining(['jsdoc', 'promise', 'react']))
  })

  it('does not re-add a plugin that is already enabled', () => {
    const { applied } = mergeRecommendations({ plugins: ['react', 'unicorn'] }, [plugin('react')])

    expect(applied).toEqual([])
  })
})

describe('mergeRecommendations - the additive invariant holds for any input', () => {
  const existingConfigs: OxlintConfig[] = [
    {},
    { rules: {} },
    { rules: { 'no-eval': 'off' } },
    { rules: { 'no-eval': 'warn', 'no-new-func': 'error' } },
    { categories: { correctness: 'warn' } },
    { categories: { correctness: 'off', suspicious: 'error' } },
    { plugins: [] },
    { plugins: ['vue'] },
    { rules: { 'typescript/no-explicit-any': ['error', { fixToUnknown: true }] } },
  ]

  const recommendations = [
    rule('no-eval', 'error'),
    rule('no-new-func', 'warn'),
    rule('typescript/no-explicit-any', 'warn'),
    category('correctness', 'error'),
    category('suspicious', 'warn'),
    plugin('react'),
    plugin('vitest'),
  ]

  const severityRank = { off: 0, warn: 1, error: 2 } as const

  for (const [index, existing] of existingConfigs.entries()) {
    it(`never weakens or removes anything for config #${index}`, () => {
      const { config } = mergeRecommendations(existing, recommendations)

      // No rule is removed or weakened.
      for (const [name, severity] of Object.entries(existing.rules ?? {})) {
        const merged = config.rules?.[name]
        expect(merged).toBeDefined()
        expect(severityRank[toSeverity(merged as never)]).toBeGreaterThanOrEqual(
          severityRank[toSeverity(severity)],
        )
      }

      // No category is removed or weakened.
      for (const [name, severity] of Object.entries(existing.categories ?? {})) {
        const merged = config.categories?.[name as keyof typeof config.categories]
        expect(merged).toBeDefined()
        expect(severityRank[merged as never]).toBeGreaterThanOrEqual(severityRank[severity])
      }

      // No plugin is disabled: everything previously active stays active.
      const previouslyActive = existing.plugins ?? OXLINT_DEFAULT_PLUGINS
      const nowActive = config.plugins ?? OXLINT_DEFAULT_PLUGINS
      for (const activePlugin of previouslyActive) {
        expect(nowActive).toContain(activePlugin)
      }
    })
  }
})
