/**
 * Regenerates the inventories under `docs/` from the schemas shipped by the installed
 * toolchain, so the record of what each tool actually offers is derived rather than
 * hand-maintained.
 *
 * Sources (all local, all versioned by the lockfile):
 *   - node_modules/oxlint/configuration_schema.json  -> docs/oxlint-rules.tsv
 *   - node_modules/oxfmt/configuration_schema.json   -> docs/oxfmt-rules.tsv
 *   - node_modules/oxlint-tsgolint/README.md         -> docs/tsgolint-rules.tsv
 *   - the two above, joined                          -> docs/oxlint-vs-tsgolint.tsv
 *
 * `src/rule-inventory.test.ts` checks the recommender against these files, which catches a
 * rule renamed out from under it. It cannot see a rule Oxlint added or one it removed that
 * nothing references, so `--check` in `pnpm check` is what keeps the files from drifting.
 *
 * Usage:
 *   node scripts/sync-rule-inventories.ts            rewrite the inventories
 *   node scripts/sync-rule-inventories.ts --check    fail if any inventory is stale
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = join(repoRoot, 'docs')
const modulesDir = join(repoRoot, 'node_modules')

/** Byte-wise so the output does not depend on the host's ICU collation. */
function compareRows(a: readonly string[], b: readonly string[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? ''
    const right = b[index] ?? ''
    if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

function toTsv(header: readonly string[] | null, rows: ReadonlyArray<readonly string[]>): string {
  const lines = rows.map((row) => row.join('\t'))
  return `${(header ? [header.join('\t'), ...lines] : lines).join('\n')}\n`
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${what} to be an object; the source schema layout changed.`)
  }
  return value as Record<string, unknown>
}

function propertyNames(container: unknown, what: string): string[] {
  return Object.keys(requireRecord(requireRecord(container, what).properties, `${what}.properties`))
}

/** `plugin/rule` for plugin rules, bare for the built-in `eslint` plugin. */
function splitOxlintRuleName(ruleName: string): [rule: string, plugin: string] {
  const separator = ruleName.indexOf('/')
  return separator === -1
    ? [ruleName, 'eslint']
    : [ruleName.slice(separator + 1), ruleName.slice(0, separator)]
}

async function readOxlintRuleNames(): Promise<string[]> {
  const schema = await readJson(join(modulesDir, 'oxlint', 'configuration_schema.json'))
  const definitions = requireRecord(schema.definitions, 'oxlint schema definitions')
  const names = propertyNames(definitions.DummyRuleMap, 'oxlint DummyRuleMap')

  if (names.length < 500) {
    throw new Error(`Read only ${names.length} Oxlint rules; the schema layout likely changed.`)
  }

  return names
}

async function readTsgolintStatuses(): Promise<Map<string, 'implemented' | 'not-implemented'>> {
  const readme = await readFile(join(modulesDir, 'oxlint-tsgolint', 'README.md'), 'utf-8')
  const statuses = new Map<string, 'implemented' | 'not-implemented'>()

  // The README tracks coverage as a task list of typescript-eslint rule links.
  for (const match of readme.matchAll(
    /^- \[( |x)\] \[([a-z-]+)\]\(https:\/\/typescript-eslint\.io\/rules\//gm,
  )) {
    statuses.set(match[2], match[1] === 'x' ? 'implemented' : 'not-implemented')
  }

  if (statuses.size < 40) {
    throw new Error(
      `Read only ${statuses.size} tsgolint rules; the README's coverage list layout likely changed.`,
    )
  }

  return statuses
}

function buildOxlintRulesTsv(oxlintRuleNames: string[]): string {
  return toTsv(null, oxlintRuleNames.map(splitOxlintRuleName).sort(compareRows))
}

function buildTsgolintRulesTsv(statuses: Map<string, 'implemented' | 'not-implemented'>): string {
  const rows = [...statuses]
    .map(([rule, status]) => [rule, status, `typescript/${rule}`])
    .sort(compareRows)

  return toTsv(['rule', 'status', 'oxlint_key'], rows)
}

function buildOxlintVsTsgolintTsv(
  oxlintRuleNames: string[],
  statuses: Map<string, 'implemented' | 'not-implemented'>,
): string {
  const rows = oxlintRuleNames
    .filter((ruleName) => ruleName.startsWith('typescript/'))
    .map((ruleName) => {
      const bareRule = ruleName.slice('typescript/'.length)
      const status = statuses.get(bareRule)
      return status ? [ruleName, 'yes', status] : [ruleName, 'no', 'n/a']
    })
    .sort(compareRows)

  return toTsv(['oxlint_key', 'in_tsgolint_readme', 'tsgolint_status'], rows)
}

async function buildOxfmtOptionsTsv(): Promise<string> {
  const schema = await readJson(join(modulesDir, 'oxfmt', 'configuration_schema.json'))
  const definitions = requireRecord(schema.definitions, 'oxfmt schema definitions')
  const rows: string[][] = []

  for (const option of propertyNames(schema, 'oxfmt schema')) {
    rows.push([option, 'top-level'])
  }
  for (const option of propertyNames(definitions.FormatConfig, 'oxfmt FormatConfig')) {
    rows.push([option, 'override.options'])
  }
  for (const option of propertyNames(
    definitions.OxfmtOverrideConfig,
    'oxfmt OxfmtOverrideConfig',
  )) {
    rows.push([`overrides[].${option}`, 'overrides'])
  }

  // Nested option objects, keyed by the top-level option that carries them.
  const nestedConfigs = {
    jsdoc: 'JsdocConfig',
    sortImports: 'SortImportsConfig',
    sortPackageJson: 'SortPackageJsonConfig',
    sortTailwindcss: 'SortTailwindcssConfig',
    svelte: 'SvelteConfig',
  } as const

  for (const [option, definitionName] of Object.entries(nestedConfigs)) {
    for (const nested of propertyNames(definitions[definitionName], `oxfmt ${definitionName}`)) {
      rows.push([`${option}.${nested}`, option])
    }
  }

  for (const nested of propertyNames(
    definitions.CustomGroupItemConfig,
    'oxfmt CustomGroupItemConfig',
  )) {
    rows.push([`sortImports.customGroups[].${nested}`, 'sortImports.customGroups'])
  }
  rows.push(['sortImports.groups[].newlinesBetween', 'sortImports.groups'])

  return toTsv(['option', 'scope'], rows.sort(compareRows))
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check')

  const oxlintRuleNames = await readOxlintRuleNames()
  const tsgolintStatuses = await readTsgolintStatuses()

  const inventories: Array<[fileName: string, content: string]> = [
    ['oxlint-rules.tsv', buildOxlintRulesTsv(oxlintRuleNames)],
    ['oxfmt-rules.tsv', await buildOxfmtOptionsTsv()],
    ['tsgolint-rules.tsv', buildTsgolintRulesTsv(tsgolintStatuses)],
    ['oxlint-vs-tsgolint.tsv', buildOxlintVsTsgolintTsv(oxlintRuleNames, tsgolintStatuses)],
  ]

  const staleFiles: string[] = []

  for (const [fileName, content] of inventories) {
    const path = join(docsDir, fileName)
    const current = await readFile(path, 'utf-8').catch(() => null)

    if (current === content) {
      continue
    }

    staleFiles.push(fileName)

    if (!checkOnly) {
      await writeFile(path, content)
    }
  }

  if (staleFiles.length === 0) {
    console.log('Rule inventories are up to date.')
    return
  }

  if (checkOnly) {
    console.error(
      `Stale rule inventories: ${staleFiles.join(', ')}\nRun \`pnpm docs:sync\` and review the diff.`,
    )
    process.exitCode = 1
    return
  }

  console.log(`Updated: ${staleFiles.join(', ')}`)
}

await main()
