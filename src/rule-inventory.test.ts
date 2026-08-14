import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getRecommendableFormatterKeys } from './format-recommender.js'
import {
  getAuditPluginRules,
  getRecommendablePlugins,
  getRecommendableRuleNames,
  getTypeAwareRuleNames,
} from './rule-recommender.js'
import type { OxlintBuiltinPlugin } from './types.js'

/**
 * The recommender must never name a rule or plugin Oxlint does not ship. The TSV under
 * docs/ is the tracked inventory; checking against it turns "these rules exist" from an
 * assumption into an assertion that fails when Oxlint renames or drops something.
 */
async function readInventory(): Promise<{ rules: Set<string>; plugins: Set<string> }> {
  const content = await readFile(join(process.cwd(), 'docs', 'oxlint-rules.tsv'), 'utf-8')
  const rules = new Set<string>()
  const plugins = new Set<string>()

  for (const line of content.split('\n')) {
    const [rawRule, rawPlugin] = line.split('\t')

    if (!rawRule || !rawPlugin) {
      continue
    }

    const rule = rawRule.trim()
    const plugin = rawPlugin.trim()

    plugins.add(plugin)
    // Configs reference `plugin/rule`, except for the built-in eslint rules which are bare.
    rules.add(plugin === 'eslint' ? rule : `${plugin}/${rule}`)
  }

  return { rules, plugins }
}

describe('recommender inventory conformance', () => {
  it('only recommends rules Oxlint actually ships', async () => {
    const { rules } = await readInventory()
    const unknown = getRecommendableRuleNames().filter((rule) => !rules.has(rule))

    expect(unknown).toEqual([])
  })

  it('only recommends plugins Oxlint actually ships', async () => {
    const { plugins } = await readInventory()
    // `react-perf` rules are listed under their own plugin; every recommendable plugin
    // must appear as a plugin column somewhere in the inventory.
    const unknown = getRecommendablePlugins().filter(
      (plugin: OxlintBuiltinPlugin) => !plugins.has(plugin),
    )

    expect(unknown).toEqual([])
  })

  it('reads a non-trivial inventory, so an empty file cannot make the check vacuous', async () => {
    const { rules, plugins } = await readInventory()

    expect(rules.size).toBeGreaterThan(500)
    expect(plugins.size).toBeGreaterThan(10)
    expect(getRecommendableRuleNames().length).toBeGreaterThan(5)
  })
})

/**
 * Type-aware rules run on the tsgolint engine, which tracks its own implementation
 * status. Recommending a rule tsgolint has not implemented would configure something that
 * silently never runs, so the status column is checked, not just the name.
 */
async function readTypeAwareInventory(): Promise<Map<string, string>> {
  const content = await readFile(join(process.cwd(), 'docs', 'tsgolint-rules.tsv'), 'utf-8')
  const statusByRule = new Map<string, string>()

  for (const line of content.split('\n').slice(1)) {
    const [, status, oxlintKey] = line.split('\t')

    if (status && oxlintKey) {
      statusByRule.set(oxlintKey.trim(), status.trim())
    }
  }

  return statusByRule
}

describe('type-aware inventory conformance', () => {
  it('only recommends type-aware rules tsgolint has actually implemented', async () => {
    const statusByRule = await readTypeAwareInventory()
    const notImplemented = getTypeAwareRuleNames().filter(
      (rule) => statusByRule.get(rule) !== 'implemented',
    )

    expect(notImplemented).toEqual([])
  })

  it('reads a tsgolint inventory that actually distinguishes statuses', async () => {
    const statusByRule = await readTypeAwareInventory()
    const statuses = new Set(statusByRule.values())

    expect(statusByRule.size).toBeGreaterThan(50)
    // If every row said "implemented" the check above would be vacuous.
    expect(statuses).toContain('not-implemented')
  })

  it('recommends only type-aware rules that are also in the main Oxlint inventory', async () => {
    const { rules } = await readInventory()
    const missing = getTypeAwareRuleNames().filter((rule) => !rules.has(rule))

    expect(missing).toEqual([])
  })
})

/**
 * `docs/oxlint-vs-tsgolint.tsv` maps every `typescript/*` rule Oxlint ships to whether
 * tsgolint implements it, which is the half `tsgolint-rules.tsv` cannot answer: which
 * typescript rules run *without* type information.
 *
 * A rule that needs type information but is recommended outside the tsgolint gate is
 * silently dead - Oxlint accepts the config, and the rule never fires.
 */
async function readTypeAwareRequirement(): Promise<Map<string, string>> {
  const content = await readFile(join(process.cwd(), 'docs', 'oxlint-vs-tsgolint.tsv'), 'utf-8')
  const statusByRule = new Map<string, string>()

  for (const line of content.split('\n').slice(1)) {
    const [oxlintKey, , status] = line.split('\t')

    if (oxlintKey && status) {
      statusByRule.set(oxlintKey.trim(), status.trim())
    }
  }

  return statusByRule
}

describe('type-aware gating conformance', () => {
  it('never recommends a type-aware rule outside the tsgolint gate', async () => {
    const statusByRule = await readTypeAwareRequirement()
    const gated = new Set(getTypeAwareRuleNames())
    const ungated = getRecommendableRuleNames().filter((rule) => !gated.has(rule))

    const needsTypeInformation = ungated.filter((rule) => statusByRule.get(rule) === 'implemented')

    expect(needsTypeInformation).toEqual([])
  })

  it('reads a mapping that actually distinguishes the two, so the check is not vacuous', async () => {
    const statusByRule = await readTypeAwareRequirement()
    const statuses = new Set(statusByRule.values())

    expect(statusByRule.size).toBeGreaterThan(100)
    expect(statuses).toEqual(new Set(['implemented', 'n/a']))
    // Every rule the recommender gates on tsgolint must appear here as type-aware,
    // otherwise the mapping and the gate disagree about the same rule.
    for (const rule of getTypeAwareRuleNames()) {
      expect(statusByRule.get(rule)).toBe('implemented')
    }
  })
})

/**
 * oxfmt is the other half of the toolchain, and its configuration surface is tracked the
 * same way. A key that oxfmt does not recognise sits in the file doing nothing, which is
 * worse than absent because it reads as a decision that was made.
 */
async function readFormatterInventory(): Promise<Set<string>> {
  const content = await readFile(join(process.cwd(), 'docs', 'oxfmt-rules.tsv'), 'utf-8')

  return new Set(
    content
      .split('\n')
      .slice(1)
      .map((line) => line.split('\t')[0]?.trim())
      .filter((option): option is string => option !== undefined && option.length > 0),
  )
}

describe('formatter inventory conformance', () => {
  it('only writes options oxfmt actually accepts', async () => {
    const options = await readFormatterInventory()
    const unknown = getRecommendableFormatterKeys().filter((key) => !options.has(key))

    expect(unknown).toEqual([])
  })

  it('reads a non-trivial formatter inventory', async () => {
    const options = await readFormatterInventory()

    expect(options.size).toBeGreaterThan(50)
    expect(getRecommendableFormatterKeys().length).toBeGreaterThan(5)
  })
})

/**
 * The js-plugin rules come from `plugins/`, not from Oxlint, so the built-in inventory
 * cannot vouch for them. Their source of truth is each plugin's own `index.ts` rule map;
 * reading it here means renaming a rule in the plugin without updating the recommender
 * fails the build instead of writing a config that names a rule nothing registers.
 */
async function readPluginRuleKeys(plugin: string): Promise<Set<string>> {
  const source = await readFile(join(process.cwd(), 'plugins', 'src', plugin, 'index.ts'), 'utf-8')
  const body = source.slice(source.indexOf('rules: {'))

  return new Set([...body.matchAll(/"([a-z0-9-]+)":/gu)].map(([, key]) => `${plugin}/${key ?? ''}`))
}

describe('audit plugin conformance', () => {
  it('only recommends rules the plugins actually register', async () => {
    const unknown: string[] = []

    for (const { plugin, rules } of getAuditPluginRules()) {
      const registered = await readPluginRuleKeys(plugin)
      unknown.push(...rules.filter((rule) => !registered.has(rule)))
    }

    expect(unknown).toEqual([])
  })

  it('reads real rule maps, so a parsing failure cannot make the check vacuous', async () => {
    for (const { plugin, rules } of getAuditPluginRules()) {
      const registered = await readPluginRuleKeys(plugin)

      expect(registered.size).toBeGreaterThan(1)
      expect(rules.length).toBeGreaterThan(1)
    }
  })

  it('names every plugin the package ships', async () => {
    const shipped = await readFile(join(process.cwd(), 'plugins', 'package.json'), 'utf-8')
    const exported = Object.keys(JSON.parse(shipped).exports as Record<string, string>).map(
      (entry) => entry.replace('./', ''),
    )

    expect(
      getAuditPluginRules()
        .map(({ plugin }) => plugin)
        .sort(),
    ).toEqual(exported.sort())
  })
})
