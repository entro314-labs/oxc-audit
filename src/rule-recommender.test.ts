import { describe, expect, it } from 'vitest'

import {
  findPrerequisites,
  getRecommendablePlugins,
  recommendForStack,
} from './rule-recommender.js'
import type { AuditRequest, EvidenceKind, ProjectStack, StackSignalId } from './types.js'

function stackOf(signals: Array<StackSignalId | [StackSignalId, EvidenceKind]>): ProjectStack {
  return {
    projectDir: '/project',
    packageJsonPath: '/project/package.json',
    signals: signals.map((entry) => {
      const [id, kind] = Array.isArray(entry) ? entry : [entry, 'dependency' as const]
      return { id, evidence: [{ kind, value: id }] }
    }),
    sourceExtensions: ['.ts'],
    filesScanned: 1,
    scanTruncated: false,
  }
}

function jsPluginTargets(stack: ProjectStack): string[] {
  return recommendForStack(stack)
    .filter(({ kind }) => kind === 'js-plugin')
    .map(({ target }) => target)
}

describe('audit plugin recommendations', () => {
  it('recommends nothing when the plugin package is absent', () => {
    expect(jsPluginTargets(stackOf(['typescript', 'zod', 'nextjs']))).toEqual([])
  })

  it('recommends only the plugins the detected stack justifies', () => {
    const targets = jsPluginTargets(
      stackOf(['audit-plugins', 'oxlint-plugins', 'typescript', 'zod']),
    )

    // `web-security` is stack-agnostic, so any source at all justifies it.
    expect(targets).toEqual(['data-layer', 'web-security', 'slop-stop'])
  })

  it('recommends the stack-agnostic security plugin from a source signal alone', () => {
    expect(jsPluginTargets(stackOf(['audit-plugins', 'oxlint-plugins', 'esm']))).toEqual([
      'web-security',
    ])
  })

  it('recommends the Supabase plugin only when Supabase is present', () => {
    expect(jsPluginTargets(stackOf(['audit-plugins', 'oxlint-plugins', 'supabase']))).toEqual([
      'supabase',
    ])
    expect(jsPluginTargets(stackOf(['audit-plugins', 'oxlint-plugins', 'drizzle']))).not.toContain(
      'supabase',
    )
  })

  it('recommends a plugin for any one of the stacks it covers', () => {
    expect(jsPluginTargets(stackOf(['audit-plugins', 'oxlint-plugins', 'drizzle']))).toEqual([
      'data-layer',
    ])
    expect(jsPluginTargets(stackOf(['audit-plugins', 'oxlint-plugins', 'stripe']))).toEqual([
      'ai-integrations',
    ])
    expect(jsPluginTargets(stackOf(['audit-plugins', 'oxlint-plugins', 'vite']))).toEqual([
      'ts-tooling',
    ])
  })

  it('carries each plugin its rules, scoped to that plugin', () => {
    const rules = recommendForStack(stackOf(['audit-plugins', 'oxlint-plugins', 'vite']))
      .filter(({ kind, target }) => kind === 'rule' && target.includes('/'))
      .map(({ target }) => target)
      .filter((target) => target.startsWith('ts-tooling/'))

    expect(rules).toEqual([
      'ts-tooling/no-removed-vitest-config',
      'ts-tooling/no-removed-vitest-exports',
    ])
  })

  it('never recommends the rule that fires on every pre-existing assertion', () => {
    const targets = recommendForStack(
      stackOf(['audit-plugins', 'oxlint-plugins', 'typescript']),
    ).map(({ target }) => target)

    expect(targets).not.toContain('slop-stop/require-safety-comment-for-type-assertion')
  })

  it('names the package when it is a dependency', () => {
    const entry = recommendForStack(stackOf(['audit-plugins', 'oxlint-plugins', 'zod'])).find(
      ({ kind }) => kind === 'js-plugin',
    )

    // A bare specifier, resolved through the package's `exports` map.
    expect(entry?.specifier).toBe('oxlint-audit-plugins/data-layer')
  })

  it('points at the vendored copy when the plugins were copied into the tree', () => {
    const entry = recommendForStack(
      stackOf([['audit-plugins', 'config-file'], 'oxlint-plugins', 'zod']),
    ).find(({ kind }) => kind === 'js-plugin')

    expect(entry?.specifier).toBe('./tools/oxlint/audit-plugins/data-layer/index.ts')
  })

  it('is a pure function of the stack', () => {
    const stack = stackOf(['audit-plugins', 'oxlint-plugins', 'typescript', 'zod', 'nextjs'])

    expect(recommendForStack(stack)).toEqual(recommendForStack(stack))
  })
})

/**
 * The custom plugins supplement Oxlint's built-in rules; they never replace them. A stack
 * that earns a js-plugin has to earn the built-in plugin covering the same ground too,
 * otherwise the config catches the migration residue and misses the ordinary mistakes.
 */
describe('built-in rules accompany the custom plugins', () => {
  const pairs: Array<{ signals: StackSignalId[]; jsPlugin: string; builtins: string[] }> = [
    { signals: ['nextjs', 'react'], jsPlugin: 'next-react', builtins: ['react', 'nextjs'] },
    { signals: ['vitest'], jsPlugin: 'ts-tooling', builtins: ['vitest'] },
    { signals: ['typescript'], jsPlugin: 'slop-stop', builtins: ['typescript'] },
  ]

  for (const { signals, jsPlugin, builtins } of pairs) {
    it(`enables ${builtins.join(' and ')} alongside ${jsPlugin}`, () => {
      const recommendations = recommendForStack(
        stackOf(['audit-plugins', 'oxlint-plugins', ...signals]),
      )
      const enabled = recommendations
        .filter(({ kind }) => kind === 'plugin')
        .map(({ target }) => target)

      expect(jsPluginTargets(stackOf(['audit-plugins', 'oxlint-plugins', ...signals]))).toContain(
        jsPlugin,
      )
      for (const builtin of builtins) {
        expect(enabled).toContain(builtin)
      }
    })
  }

  it('recommends the injection primitives web-security does not reimplement', () => {
    const targets = recommendForStack(stackOf(['typescript'])).map(({ target }) => target)

    for (const rule of [
      'no-eval',
      'no-new-func',
      'no-implied-eval',
      'no-script-url',
      'unicorn/require-post-message-target-origin',
    ]) {
      expect(targets).toContain(rule)
    }
  })

  // A rule from a plugin the config never enables is dead config at best. JSX without React
  // - Preact, Solid - is the case that catches it.
  const stacks: StackSignalId[][] = [
    ['jsx'],
    ['jsx', 'typescript'],
    ['react'],
    ['nextjs'],
    ['vue'],
    ['typescript'],
  ]

  it.each(stacks)('never names a plugin rule without enabling that plugin (%s)', (...signals) => {
    const recommendations = recommendForStack(stackOf(signals))
    const enabled = new Set(
      recommendations.filter(({ kind }) => kind === 'plugin').map(({ target }) => target),
    )
    const builtinPlugins = new Set<string>(getRecommendablePlugins())

    const orphaned = recommendations
      .filter(({ kind }) => kind === 'rule')
      .map(({ target }) => target.split('/')[0] ?? '')
      .filter((owner) => builtinPlugins.has(owner) && !enabled.has(owner))

    expect(orphaned).toEqual([])
  })
})

describe('audit plugin prerequisites', () => {
  it('names the applicable plugins when the package is not installed', () => {
    const prerequisite = findPrerequisites(stackOf(['zod', 'stripe'])).find(({ capability }) =>
      capability.startsWith('Stack-specific audit rules'),
    )

    expect(prerequisite?.capability).toContain('data-layer')
    expect(prerequisite?.capability).toContain('ai-integrations')
    expect(prerequisite?.install).toBe('pnpm add -D oxlint-audit-plugins')
  })

  it('needs no separate runtime when the package is installed', () => {
    // `oxlint-audit-plugins` declares `@oxlint/plugins` as a dependency, so installing it
    // brings the runtime; requiring a second install would withhold rules that already work.
    expect(jsPluginTargets(stackOf(['audit-plugins', 'zod']))).toContain('data-layer')
    expect(
      findPrerequisites(stackOf(['audit-plugins', 'zod'])).some(({ capability }) =>
        capability.startsWith('Stack-specific'),
      ),
    ).toBe(false)
  })

  it('does need the runtime when the sources are only a copy in the tree', () => {
    // A copied directory carries no manifest, so nothing guarantees the runtime is there.
    const vendored = stackOf([['audit-plugins', 'config-file'], 'zod'])

    expect(jsPluginTargets(vendored)).toEqual([])
    expect(
      jsPluginTargets(stackOf([['audit-plugins', 'config-file'], 'oxlint-plugins', 'zod'])),
    ).toContain('data-layer')
  })

  it('asks for the runtime once the sources are present some other way', () => {
    const prerequisite = findPrerequisites(stackOf([['audit-plugins', 'config-file'], 'zod'])).find(
      ({ capability }) => capability.startsWith('Stack-specific audit rules'),
    )

    // The plugins are there but nothing can load them without `@oxlint/plugins`.
    expect(prerequisite?.install).toBe('pnpm add -D @oxlint/plugins')
  })

  it('stays quiet when no covered stack is present', () => {
    const capabilities = findPrerequisites(stackOf(['jsdoc'])).map(({ capability }) => capability)

    expect(capabilities.some((entry) => entry.startsWith('Stack-specific'))).toBe(false)
  })

  it('stops asking once the package is installed', () => {
    const capabilities = findPrerequisites(stackOf(['audit-plugins', 'oxlint-plugins', 'zod'])).map(
      ({ capability }) => capability,
    )

    expect(capabilities.some((entry) => entry.startsWith('Stack-specific'))).toBe(false)
  })
})

function request(overrides: Partial<AuditRequest> = {}): AuditRequest {
  return { level: 'recommended', domains: [], maximal: false, forcedSignals: [], ...overrides }
}

const FULL_STACK: StackSignalId[] = ['typescript', 'tsconfig', 'tsgolint', 'jsx', 'react', 'esm']

function targetsAt(overrides: Partial<AuditRequest>): string[] {
  return recommendForStack(stackOf(FULL_STACK), request(overrides)).map(({ target }) => target)
}

describe('the level ladder', () => {
  it('defaults to recommended when nothing is asked for', () => {
    const stack = stackOf(FULL_STACK)

    expect(recommendForStack(stack)).toEqual(
      recommendForStack(stack, request({ level: 'recommended' })),
    )
  })

  it('is strictly cumulative - each level is a superset of the one below', () => {
    const levels = ['basic', 'recommended', 'strict', 'paranoid'] as const

    for (const [index, level] of levels.entries()) {
      const lower = levels[index - 1]

      if (lower === undefined) {
        continue
      }

      const below = new Set(targetsAt({ level: lower }))
      const missing = [...below].filter((target) => !targetsAt({ level }).includes(target))

      expect(missing).toEqual([])
    }
  })

  it('reaches a wider set of Oxlint categories as it climbs', () => {
    const categoriesAt = (level: AuditRequest['level']): string[] =>
      recommendForStack(stackOf(FULL_STACK), request({ level }))
        .filter(({ kind }) => kind === 'category')
        .map(({ target }) => target)

    expect(categoriesAt('basic')).toEqual(['correctness'])
    expect(categoriesAt('recommended')).toEqual(['correctness', 'suspicious'])
    expect(categoriesAt('strict')).toEqual(['correctness', 'suspicious', 'pedantic', 'perf'])
    expect(categoriesAt('paranoid')).toEqual(categoriesAt('strict'))
  })

  // Measured against a codebase that passes its own lint, `style` alone reports ~1,200
  // findings and `restriction` ~400 - all of it taste. Enabling either wholesale is the
  // unasked-for churn this tool exists not to create.
  it.each(['nursery', 'style', 'restriction'])('never enables the %s category', (category) => {
    expect(targetsAt({ level: 'paranoid', maximal: true })).not.toContain(category)
  })

  it('carries no type-aware rules at basic, and does not ask for the engine option', () => {
    const targets = targetsAt({ level: 'basic' })

    expect(targets.filter((target) => target.startsWith('typescript/'))).toEqual([])
    expect(targets).not.toContain('typeAware')
  })

  it('scales type-aware coverage with the level', () => {
    const typeAwareCount = (level: AuditRequest['level']): number =>
      targetsAt({ level }).filter((target) => target.startsWith('typescript/')).length

    expect(typeAwareCount('basic')).toBe(0)
    expect(typeAwareCount('recommended')).toBeGreaterThan(20)
    expect(typeAwareCount('strict')).toBeGreaterThan(typeAwareCount('recommended'))
    expect(typeAwareCount('paranoid')).toBeGreaterThan(typeAwareCount('strict'))
  })

  it('keeps the noisiest whole-codebase policies out until paranoid', () => {
    expect(targetsAt({ level: 'strict' })).not.toContain('typescript/strict-boolean-expressions')
    expect(targetsAt({ level: 'paranoid' })).toContain('typescript/strict-boolean-expressions')
  })
})

describe('domain sets', () => {
  it('reaches its rules from any level', () => {
    const targets = targetsAt({ level: 'basic', domains: ['accessibility'] })

    expect(targets).toContain('jsx-a11y/alt-text')
    expect(targets).not.toContain('typescript/strict-boolean-expressions')
  })

  it('reaches Oxlint categories too, not just individual rules', () => {
    const targets = targetsAt({ level: 'basic', domains: ['performance'] })

    expect(targets).toContain('perf')
    expect(targets).toContain('oxc/no-accumulating-spread')
  })

  it('pulls in a js plugin the level would not have reached', () => {
    const stack = stackOf(['audit-plugins', 'oxlint-plugins', 'esm', 'supabase'])
    const targets = recommendForStack(
      stack,
      request({ level: 'basic', domains: ['security'] }),
    ).map(({ target }) => target)

    expect(targets).toContain('supabase')
  })

  it('stays evidence-gated - a domain cannot conjure rules for an absent stack', () => {
    const targets = recommendForStack(
      stackOf(['esm']),
      request({ level: 'paranoid', domains: ['accessibility'] }),
    ).map(({ target }) => target)

    expect(targets.filter((target) => target.startsWith('jsx-a11y/'))).toEqual([])
  })
})

describe('--dom', () => {
  it('matches paranoid with every domain on', () => {
    const maximal = recommendForStack(stackOf(FULL_STACK), request({ maximal: true }))
    const explicit = recommendForStack(
      stackOf(FULL_STACK),
      request({ level: 'paranoid', domains: ['security', 'performance', 'accessibility'] }),
    )

    expect(maximal).toEqual(explicit)
  })

  it('overrides a lower level rather than being capped by it', () => {
    const targets = targetsAt({ level: 'basic', maximal: true })

    expect(targets).toContain('typescript/strict-boolean-expressions')
  })

  it('still recommends nothing without evidence', () => {
    const targets = recommendForStack(stackOf(['esm']), request({ maximal: true })).map(
      ({ target }) => target,
    )

    expect(targets.filter((target) => target.startsWith('typescript/'))).toEqual([])
    expect(targets.filter((target) => target.startsWith('jsx-a11y/'))).toEqual([])
  })
})
