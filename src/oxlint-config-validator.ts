import type { OxlintConfig } from './types.js'

/**
 * Structural validation of an Oxlint config against constraints the tool enforces at load
 * time.
 *
 * Oxlint resolves glob patterns relative to the directory holding the config file and
 * rejects `..` outright: "Invalid pattern `../x` in `ignorePatterns`: `..` is not
 * supported, patterns are resolved within the config file's directory". Writing such a
 * config would leave the project with one Oxlint cannot load, so it is caught before the
 * file is written rather than after.
 */
export function validateOxlintConfig(oxlintConfig: OxlintConfig): string[] {
  return validatePatternGroups('.oxlintrc.json', collectOxlintPatternGroups(oxlintConfig))
}

interface PatternGroup {
  field: string
  patterns: string[] | undefined
}

function collectOxlintPatternGroups(config: OxlintConfig): PatternGroup[] {
  return [
    { field: 'ignorePatterns', patterns: config.ignorePatterns },
    ...(config.overrides ?? []).flatMap((override, index) => [
      { field: `overrides[${index}].files`, patterns: override.files },
      { field: `overrides[${index}].excludeFiles`, patterns: override.excludeFiles },
    ]),
  ]
}

function validatePatternGroups(configName: string, groups: PatternGroup[]): string[] {
  const problems: string[] = []

  for (const { field, patterns } of groups) {
    for (const pattern of patterns ?? []) {
      const problem = findPatternProblem(pattern)

      if (problem) {
        problems.push(`${configName}: ${field} pattern "${pattern}" ${problem}`)
      }
    }
  }

  return problems
}

function findPatternProblem(pattern: string): string | undefined {
  const body = pattern.startsWith('!') ? pattern.slice(1) : pattern

  if (body.split('/').includes('..')) {
    return 'escapes the config directory with "..", which Oxlint rejects'
  }

  if (body.startsWith('/') || /^[A-Za-z]:[/\\]/u.test(body)) {
    return 'is an absolute path, but patterns are resolved within the config directory'
  }

  return undefined
}
