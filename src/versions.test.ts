import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { minimumVersionOf, OXC_TOOL_VERSIONS } from './versions.js'

describe('OXC_TOOL_VERSIONS', () => {
  it('matches the toolchain this package is built and tested against', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf-8')) as {
      devDependencies: Record<string, string>
    }

    for (const [tool, version] of Object.entries(OXC_TOOL_VERSIONS)) {
      expect(minimumVersionOf(manifest.devDependencies[tool] ?? '')).toBe(version)
    }
  })
})
