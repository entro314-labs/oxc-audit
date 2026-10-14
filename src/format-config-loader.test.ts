import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findExistingFormatterConfig } from './format-config-loader.js'
import { CollectingReporter } from './reporter.js'

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-format-'))

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }

  return dir
}

describe('findExistingFormatterConfig', () => {
  it("pins Prettier's 80-column default, which oxfmt does not share", async () => {
    const dir = await setupProject({ '.prettierrc.json': '{ "semi": false }' })

    const found = await findExistingFormatterConfig(dir, new CollectingReporter())

    expect(found?.settings).toEqual({ semi: false, printWidth: 80 })
  })

  it("pins Biome's tabs and 80 columns when its config leaves them at the defaults", async () => {
    const dir = await setupProject({ 'biome.json': '{ "formatter": { "enabled": true } }' })

    const found = await findExistingFormatterConfig(dir, new CollectingReporter())

    expect(found?.settings).toEqual({ printWidth: 80, useTabs: true })
  })

  it('leaves the width to .editorconfig when it sets one, as both formatters read it', async () => {
    const dir = await setupProject({
      '.prettierrc.json': '{}',
      '.editorconfig': '[*]\nmax_line_length = 120\n',
    })

    const found = await findExistingFormatterConfig(dir, new CollectingReporter())

    expect(found?.settings).toEqual({})
  })

  it('never overrides a width the source config set', async () => {
    const dir = await setupProject({ '.prettierrc.json': '{ "printWidth": 120 }' })

    const found = await findExistingFormatterConfig(dir, new CollectingReporter())

    expect(found?.settings.printWidth).toBe(120)
  })

  it('reads a YAML .prettierrc and the .yaml spelling', async () => {
    for (const name of ['.prettierrc', '.prettierrc.yaml']) {
      const dir = await setupProject({ [name]: 'semi: false\nsingleQuote: true\n' })

      const found = await findExistingFormatterConfig(dir, new CollectingReporter())

      expect(found?.settings).toMatchObject({ semi: false, singleQuote: true })
    }
  })

  it('reads the prettier key of package.json first, as Prettier does', async () => {
    const dir = await setupProject({
      'package.json': JSON.stringify({ name: 'app', prettier: { semi: false } }),
      '.prettierrc.json': '{ "semi": true }',
    })

    const found = await findExistingFormatterConfig(dir, new CollectingReporter())

    expect(found?.settings.semi).toBe(false)
  })

  it('reports what it could not carry rather than dropping it silently', async () => {
    const dir = await setupProject({
      '.prettierrc.json':
        '{ "endOfLine": "auto", "plugins": ["prettier-plugin-organize-imports"] }',
    })
    const reporter = new CollectingReporter()

    await findExistingFormatterConfig(dir, reporter)

    expect(reporter.getWarnings().join('\n')).toMatch(/endOfLine: "auto"/su)
  })

  it('reports a TOML config it cannot parse', async () => {
    const dir = await setupProject({ '.prettierrc.toml': 'semi = false\n' })
    const reporter = new CollectingReporter()

    expect(await findExistingFormatterConfig(dir, reporter)).toBeUndefined()
    expect(reporter.getWarnings().join('\n')).toMatch(/TOML/u)
  })
})
