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
      jsPlugin(
        'data-layer',
        './node_modules/@entro314labs/oxlint-audit-plugins/src/data-layer/index.ts',
      ),
    ])

    expect(config.jsPlugins).toEqual([
      {
        name: 'data-layer',
        specifier: './node_modules/@entro314labs/oxlint-audit-plugins/src/data-layer/index.ts',
      },
    ])
    expect(applied).toHaveLength(1)
  })

  it('keeps existing entries when adding one', () => {
    const { config } = mergeRecommendations({ jsPlugins: ['./local/plugin.ts'] }, [
      jsPlugin(
        'slop-stop',
        './node_modules/@entro314labs/oxlint-audit-plugins/src/slop-stop/index.ts',
      ),
    ])

    expect(config.jsPlugins).toHaveLength(2)
    expect(config.jsPlugins?.[0]).toBe('./local/plugin.ts')
  })

  it('does not re-add a plugin already registered in object form', () => {
    const { config, applied, alreadySatisfied } = mergeRecommendations(
      { jsPlugins: [{ name: 'data-layer', specifier: './tools/oxlint/data-layer/index.ts' }] },
      [
        jsPlugin(
          'data-layer',
          './node_modules/@entro314labs/oxlint-audit-plugins/src/data-layer/index.ts',
        ),
      ],
    )

    // The project's own path wins; a second entry for the same plugin would be a conflict.
    expect(config.jsPlugins).toHaveLength(1)
    expect(applied).toEqual([])
    expect(alreadySatisfied).toHaveLength(1)
  })

  it('recognises a plugin already registered in bare-string form', () => {
    const { config, alreadySatisfied } = mergeRecommendations(
      { jsPlugins: ['./tools/oxlint/audit-plugins/next-react/index.ts'] },
      [
        jsPlugin(
          'next-react',
          './node_modules/@entro314labs/oxlint-audit-plugins/src/next-react/index.ts',
        ),
      ],
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

describe('mergeRecommendations - a recommended off fills a gap and never overrides', () => {
  it('writes the off when the rule is not mentioned', () => {
    const { config, applied } = mergeRecommendations({}, [rule('react/react-in-jsx-scope', 'off')])

    expect(config.rules?.['react/react-in-jsx-scope']).toBe('off')
    expect(applied).toHaveLength(1)
  })

  it.each(['warn', 'error', 'off'] as const)('leaves an explicit %s alone', (existing) => {
    const { config, applied, alreadySatisfied, explicitlyDisabled } = mergeRecommendations(
      { rules: { 'react/react-in-jsx-scope': existing } },
      [rule('react/react-in-jsx-scope', 'off')],
    )

    expect(config.rules?.['react/react-in-jsx-scope']).toBe(existing)
    expect(applied).toEqual([])
    expect(alreadySatisfied).toHaveLength(1)
    // A project's own `error` is not an opt-out, so it is not reported as one.
    expect(explicitlyDisabled).toEqual([])
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

describe('mergeRecommendations - rule options', () => {
  const withOptions: Recommendation = {
    ...rule('typescript/no-misused-promises', 'error'),
    options: [{ checksVoidReturn: { attributes: false } }],
  }

  it('writes options with the severity when the rule is absent', () => {
    const { config } = mergeRecommendations({}, [withOptions])

    expect(config.rules?.['typescript/no-misused-promises']).toEqual([
      'error',
      { checksVoidReturn: { attributes: false } },
    ])
  })

  it('never adds options to a rule the config already names', () => {
    const { config, alreadySatisfied } = mergeRecommendations(
      { rules: { 'typescript/no-misused-promises': 'error' } },
      [withOptions],
    )

    expect(config.rules?.['typescript/no-misused-promises']).toBe('error')
    expect(alreadySatisfied).toHaveLength(1)
  })

  it('raises a weaker entry without swapping its options for the recommended ones', () => {
    const { config } = mergeRecommendations(
      { rules: { 'typescript/no-misused-promises': ['warn', { checksConditionals: false }] } },
      [withOptions],
    )

    expect(config.rules?.['typescript/no-misused-promises']).toEqual([
      'error',
      { checksConditionals: false },
    ])
  })
})

describe('mergeRecommendations - env', () => {
  const env = (target: string): Recommendation => ({
    kind: 'env',
    target,
    reason: 'test',
    triggeredBy: [],
  })

  it('adds an environment beside the ones already declared', () => {
    const { config } = mergeRecommendations({ env: { es2024: true } }, [env('node')])

    expect(config.env).toEqual({ es2024: true, node: true })
  })

  it('treats an explicit false as a decision', () => {
    const { config, explicitlyDisabled } = mergeRecommendations({ env: { browser: false } }, [
      env('browser'),
    ])

    expect(config.env).toEqual({ browser: false })
    expect(explicitlyDisabled).toHaveLength(1)
  })
})

describe('mergeRecommendations - rules scoped to files', () => {
  const testFiles = ['**/*.test.*', '**/*.spec.*']
  const scoped = (target: string): Recommendation => ({
    ...rule(target, 'off'),
    files: testFiles,
  })

  it('creates the override alongside the top-level rule this run adds', () => {
    const { config } = mergeRecommendations({}, [
      rule('typescript/no-unsafe-call', 'error'),
      scoped('typescript/no-unsafe-call'),
    ])

    expect(config.rules?.['typescript/no-unsafe-call']).toBe('error')
    expect(config.overrides).toEqual([
      { files: testFiles, rules: { 'typescript/no-unsafe-call': 'off' } },
    ])
  })

  it('adds to an existing override with the same globs in any order', () => {
    const { config } = mergeRecommendations(
      {
        overrides: [
          { files: ['**/*.spec.*', '**/*.test.*'], rules: { 'no-console': 'off' } },
          { files: ['scripts/**'], rules: {} },
        ],
      },
      [scoped('typescript/no-unsafe-call')],
    )

    expect(config.overrides).toEqual([
      {
        files: ['**/*.spec.*', '**/*.test.*'],
        rules: { 'no-console': 'off', 'typescript/no-unsafe-call': 'off' },
      },
      { files: ['scripts/**'], rules: {} },
    ])
  })

  it('leaves the tree alone when the project already set the rule at the top level', () => {
    const { config } = mergeRecommendations({ rules: { 'typescript/no-unsafe-call': 'error' } }, [
      rule('typescript/no-unsafe-call', 'error'),
      scoped('typescript/no-unsafe-call'),
    ])

    expect(config.overrides).toBeUndefined()
  })

  it('is satisfied on a second run', () => {
    const recommendations = [
      rule('typescript/no-unsafe-call', 'error'),
      scoped('typescript/no-unsafe-call'),
    ]
    const first = mergeRecommendations({}, recommendations)

    expect(mergeRecommendations(first.config, recommendations).changed).toBe(false)
  })
})
