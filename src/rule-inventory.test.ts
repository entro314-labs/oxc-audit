import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
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
