import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  findOxlintConfig,
  isPlainModuleConfig,
  loadOxlintConfig,
  serializeOxlintConfig,
} from './oxlint-config-loader.js'
import type { OxlintConfig } from './types.js'

const CONFIG: OxlintConfig = {
  plugins: ['typescript', 'react'],
  categories: { correctness: 'error' },
  rules: { 'no-eval': 'error', 'import/no-cycle': ['warn', { maxDepth: 3 }] },
}

describe('serializeOxlintConfig', () => {
  it('writes JSON for a JSON config and a defineConfig module for oxlint.config.ts', () => {
    expect(serializeOxlintConfig('/p/.oxlintrc.json', CONFIG)).toBe(
      `${JSON.stringify(CONFIG, null, 2)}\n`,
    )
    expect(serializeOxlintConfig('/p/oxlint.config.ts', CONFIG)).toBe(
      `import { defineConfig } from 'oxlint'\n\nexport default defineConfig(${JSON.stringify(CONFIG, null, 2)})\n`,
    )
  })
})

describe('isPlainModuleConfig', () => {
  const path = '/p/oxlint.config.ts'

  it('accepts the file this tool writes', () => {
    expect(isPlainModuleConfig(path, serializeOxlintConfig(path, CONFIG), CONFIG)).toBe(true)
  })

  it('accepts the same file after a formatter rewrote quotes, keys, commas and semicolons', () => {
    const formatted = `import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ['typescript', 'react'],
  categories: { correctness: 'error' },
  rules: {
    'no-eval': 'error',
    'import/no-cycle': ['warn', { maxDepth: 3 }],
  },
});
`

    expect(isPlainModuleConfig(path, formatted, CONFIG)).toBe(true)
  })

  it('accepts a bare default export of the same object', () => {
    expect(isPlainModuleConfig(path, `export default ${JSON.stringify(CONFIG)}\n`, CONFIG)).toBe(
      true,
    )
  })

  it('rejects a value computed at load time, which a rewrite would freeze', () => {
    const computed = `import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: ['typescript', 'react'],
  categories: { correctness: process.env.CI ? 'error' : 'error' },
  rules: { 'no-eval': 'error', 'import/no-cycle': ['warn', { maxDepth: 3 }] },
})
`

    expect(isPlainModuleConfig(path, computed, CONFIG)).toBe(false)
  })

  it('rejects a config built from another import', () => {
    const extended = `import { defineConfig } from 'oxlint'
import base from './base.ts'

export default defineConfig({ ...base })
`

    expect(isPlainModuleConfig(path, extended, CONFIG)).toBe(false)
  })

  it('rejects a file whose values differ from what loaded', () => {
    const text = serializeOxlintConfig(path, { ...CONFIG, rules: { 'no-eval': 'warn' } })

    expect(isPlainModuleConfig(path, text, CONFIG)).toBe(false)
  })
})

describe('loadOxlintConfig', () => {
  it('imports a module config and returns its default export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-loader-'))
    const configPath = join(dir, 'oxlint.config.mjs')
    await writeFile(configPath, `export default ${JSON.stringify(CONFIG)}\n`, 'utf-8')

    const loaded = await loadOxlintConfig(configPath)

    expect(loaded.existed).toBe(true)
    expect(loaded.config).toEqual(CONFIG)
  })

  it('reads a rewritten module config fresh rather than from the module cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-loader-'))
    const configPath = join(dir, 'oxlint.config.mjs')
    await writeFile(configPath, 'export default { rules: { "no-eval": "warn" } }\n', 'utf-8')
    await loadOxlintConfig(configPath)
    await writeFile(configPath, 'export default { rules: { "no-eval": "error" } }\n', 'utf-8')

    const loaded = await loadOxlintConfig(configPath)

    expect(loaded.config.rules?.['no-eval']).toBe('error')
  })

  it('rejects a module whose default export is not a config object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-loader-'))
    const configPath = join(dir, 'oxlint.config.mjs')
    await writeFile(configPath, 'export default ["no"]\n', 'utf-8')

    await expect(loadOxlintConfig(configPath)).rejects.toThrow(/default export/u)
  })

  it('ignores an oxlint.config.mjs, which Oxlint only loads through --config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-loader-'))
    await writeFile(join(dir, 'oxlint.config.mjs'), 'export default {}\n', 'utf-8')

    expect(await findOxlintConfig(dir)).toBeUndefined()
  })

  it('finds a module config when the project has no JSON config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oxc-audit-loader-'))
    await writeFile(join(dir, 'oxlint.config.ts'), 'export default {}\n', 'utf-8')

    expect(await findOxlintConfig(dir)).toBe(join(dir, 'oxlint.config.ts'))
  })
})
