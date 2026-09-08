/**
 * The lowest version a range can resolve to.
 *
 * Handles the forms a manifest actually contains (`^1.2.3`, `~1.2.3`, `>=1.2.3`, `1.2.3`,
 * `1.2.3 - 2.0.0`) and returns `null` for anything else, so an unparsed range is skipped
 * rather than guessed at.
 */
export function minimumVersionOf(range: string): string | null {
  const match = /^\s*(?:[\^~]|>=?)?\s*(\d+)\.(\d+)\.(\d+)/.exec(range)
  if (match === null) return null
  return `${match[1]}.${match[2]}.${match[3]}`
}

/** Negative when `a` is lower than `b`. Both must be plain `x.y.z` triples. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
