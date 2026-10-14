import { describe, expect, it } from 'vitest'

import { validateOxlintConfig } from './oxlint-config-validator.js'

describe('validateOxlintConfig', () => {
  it('accepts a root-anchored ignore pattern, which gitignore syntax allows', () => {
    expect(validateOxlintConfig({ ignorePatterns: ['/dist', '!/dist/keep.js'] })).toEqual([])
  })

  it('rejects a leading slash in overrides, where it matches nothing', () => {
    expect(validateOxlintConfig({ overrides: [{ files: ['/src/**'] }] })).toHaveLength(1)
  })

  it('rejects a pattern that leaves the config directory', () => {
    expect(validateOxlintConfig({ ignorePatterns: ['../shared'] })).toHaveLength(1)
  })

  it('rejects a drive-letter path anywhere', () => {
    expect(validateOxlintConfig({ ignorePatterns: ['C:/build'] })).toHaveLength(1)
  })
})
