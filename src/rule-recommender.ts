import { hasSignal } from './stack-detector.js'
import { AUDIT_DOMAINS } from './types.js'
import type {
  AuditDomain,
  AuditLevel,
  AuditRequest,
  OxlintBuiltinPlugin,
  OxlintCategory,
  OxlintSeverity,
  Prerequisite,
  ProjectStack,
  Recommendation,
  StackSignalId,
} from './types.js'

/** What a run asks for when nothing is stated: today's behaviour, now named. */
export const DEFAULT_REQUEST: AuditRequest = {
  level: 'recommended',
  domains: [],
  maximal: false,
  forcedSignals: [],
}

/**
 * A plugin is recommended only when the project carries evidence it is relevant.
 *
 * `requires` is an OR: any one signal is enough. Plugins with no matching signal are
 * never recommended, so the output stays proportional to what the project actually uses.
 */
const PLUGIN_RULES: Array<{
  plugin: OxlintBuiltinPlugin
  requires: StackSignalId[]
  reason: string
}> = [
  {
    plugin: 'typescript',
    requires: ['typescript'],
    reason: 'TypeScript is in use, so the typescript rules apply.',
  },
  {
    plugin: 'react',
    requires: ['react', 'nextjs'],
    reason: 'React is a dependency, so the react rules apply.',
  },
  {
    plugin: 'react-perf',
    requires: ['react-dom'],
    reason: 'React renders to the DOM here, where the react-perf rules catch re-render costs.',
  },
  {
    plugin: 'jsx-a11y',
    requires: ['jsx'],
    reason: 'JSX is present, so the accessibility rules have something to check.',
  },
  {
    plugin: 'nextjs',
    requires: ['nextjs'],
    reason: 'Next.js is in use; its rules catch framework-specific mistakes.',
  },
  { plugin: 'vue', requires: ['vue'], reason: 'Vue is in use, so the vue rules apply.' },
  {
    plugin: 'vitest',
    requires: ['vitest'],
    reason: 'Vitest is the test runner; its rules catch focused and skipped tests.',
  },
  {
    plugin: 'jest',
    requires: ['jest'],
    reason: 'Jest is the test runner; its rules catch focused and skipped tests.',
  },
  {
    plugin: 'node',
    requires: ['node'],
    reason: 'This package targets Node, so the node rules apply.',
  },
  {
    plugin: 'jsdoc',
    requires: ['jsdoc'],
    reason: 'A JSDoc toolchain is present, so doc comments are worth checking.',
  },
  {
    plugin: 'import',
    requires: ['esm', 'typescript'],
    reason: 'Module syntax is in use; the import rules catch unresolved and cyclic imports.',
  },
]

/** Where each level sits on the ladder, so `>=` comparisons read the way they mean. */
const LEVEL_RANK: Record<AuditLevel, number> = {
  basic: 0,
  recommended: 1,
  strict: 2,
  paranoid: 3,
}

/** `true` when `level` is at least `minimum` on the ladder. */
function meetsLevel(level: AuditLevel, minimum: AuditLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minimum]
}

/**
 * Oxlint's categories, laid out as the level ladder.
 *
 * Oxlint enables `correctness` alone by default. `basic` states that explicitly so the config
 * never depends on an implicit default that could change upstream, and every level above it
 * is an addition the user asked for: `suspicious` at `recommended`, then `pedantic` and
 * `perf` at `strict`, which are defensible team-wide decisions about how much to check.
 *
 * Three categories are never enabled at any level, no matter how high:
 *
 * - `style` and `restriction` are house taste, not defects. Measured against a codebase
 *   that already passes its own lint, they produce roughly 1,200 and 400 findings — things
 *   like `no-ternary`, `no-null` and `no-magic-numbers`. Turning them on wholesale is the
 *   unasked-for churn this tool exists not to create; a project that wants them can name
 *   them, and this tool will not overwrite that choice.
 * - `nursery` is explicitly unstable upstream, so a config carrying it would change meaning
 *   on an Oxlint patch and break determinism.
 *
 * `paranoid` therefore means depth of checking rather than breadth of opinion: it adds the
 * type-aware rules that reject a lot of working code, not a category of style preferences.
 */
const LEVEL_CATEGORIES: Array<{
  category: OxlintCategory
  severity: OxlintSeverity
  level: AuditLevel
  domains?: AuditDomain[]
}> = [
  { category: 'correctness', severity: 'error', level: 'basic' },
  { category: 'suspicious', severity: 'warn', level: 'recommended' },
  { category: 'pedantic', severity: 'warn', level: 'strict' },
  { category: 'perf', severity: 'warn', level: 'strict', domains: ['performance'] },
]

/**
 * Individual rules that are off by default but catch mistakes with real consequences.
 *
 * Kept deliberately short. Each entry names a concrete failure it prevents, and every
 * rule here is verified against the tracked Oxlint inventory by the conformance test.
 */
const TARGETED_RULES: Array<{
  rule: string
  severity: OxlintSeverity
  requires: StackSignalId[]
  /** Lowest level that enables it. A domain flag enables it regardless of the level. */
  level: AuditLevel
  domains?: AuditDomain[]
  reason: string
}> = [
  {
    rule: 'no-eval',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: [],
    reason: 'Evaluating strings as code turns any untrusted input into arbitrary execution.',
  },
  {
    rule: 'no-new-func',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: [],
    reason: 'The Function constructor is eval by another name.',
  },
  {
    rule: 'no-script-url',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: [],
    reason: '`javascript:` URLs execute in the page origin.',
  },
  // The injection primitives the web-security plugin deliberately does not reimplement.
  // Recommended whether or not that plugin is installed: they are built in, so they cost
  // nothing, and without them the custom rules cover only half the surface.
  {
    rule: 'no-implied-eval',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: [],
    reason: 'A string passed to setTimeout or setInterval is evaluated as code.',
  },
  {
    rule: 'unicorn/require-post-message-target-origin',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: [],
    reason: '`postMessage` without a target origin broadcasts the payload to any listener.',
  },
  {
    rule: 'unicorn/no-document-cookie',
    level: 'recommended',
    domains: ['security'],
    severity: 'warn',
    requires: [],
    reason:
      'Writing `document.cookie` directly sets a cookie with no flags, so it is readable by script and sent cross-site.',
  },
  {
    rule: 'react/iframe-missing-sandbox',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: ['react', 'nextjs'],
    reason: 'An unsandboxed iframe runs third-party markup with the privileges of the page.',
  },
  {
    rule: 'react/jsx-no-script-url',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: ['react', 'nextjs'],
    reason: '`javascript:` in a JSX href executes on click in the page origin.',
  },
  {
    rule: 'typescript/no-explicit-any',
    level: 'recommended',
    severity: 'warn',
    requires: ['typescript'],
    reason: '`any` silently disables the checks the rest of the config relies on.',
  },
  {
    rule: 'typescript/no-non-null-assertion',
    level: 'recommended',
    severity: 'warn',
    requires: ['typescript'],
    reason: 'Non-null assertions move a real runtime failure past the type checker.',
  },
  {
    rule: 'react/no-danger',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: ['react'],
    reason: 'dangerouslySetInnerHTML injects unescaped markup into the DOM.',
  },
  {
    // Gated on the same signals as the `react` plugin, not on `jsx`. A JSX project without
    // React - Preact, Solid - never enables that plugin, so the rule would be written into a
    // config that cannot run it.
    rule: 'react/jsx-no-target-blank',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: ['react', 'nextjs'],
    reason: '`target="_blank"` without `rel="noreferrer"` exposes `window.opener`.',
  },
  {
    rule: 'import/no-cycle',
    level: 'recommended',
    severity: 'warn',
    requires: ['esm', 'typescript'],
    reason: 'Import cycles produce partially-initialised modules at runtime.',
  },
  {
    rule: 'vitest/no-focused-tests',
    level: 'basic',
    severity: 'error',
    requires: ['vitest'],
    reason: 'A committed `.only` silently stops the rest of the suite from running.',
  },
  {
    rule: 'jest/no-focused-tests',
    level: 'basic',
    severity: 'error',
    requires: ['jest'],
    reason: 'A committed `.only` silently stops the rest of the suite from running.',
  },
  // Oxlint's `correctness` category already carries 33 of the 46 vue rules. These three
  // are off by default and each names a concrete failure rather than a style preference;
  // the remaining ten off-by-default vue rules are casing and declaration-style choices.
  {
    rule: 'vue/no-multiple-slot-args',
    level: 'recommended',
    severity: 'error',
    requires: ['vue'],
    reason: 'A slot receives only its first argument; any others are silently discarded.',
  },
  {
    rule: 'vue/require-typed-ref',
    level: 'recommended',
    severity: 'warn',
    requires: ['vue'],
    reason:
      'An untyped `ref()` infers `any`, so everything derived from it stops being typechecked. Only fires in `lang="ts"` blocks.',
  },
  {
    rule: 'vue/require-prop-types',
    level: 'recommended',
    severity: 'warn',
    requires: ['vue'],
    reason: 'A prop declared without a type gets no validation at all, in dev or production.',
  },
  // Accessibility. These sit at `paranoid` on the ladder because a codebase that has never
  // run them reports a great deal at once, but `--accessibility` reaches them at any level.
  // Recommended at `error` rather than `warn`: a rule-level `warn` would override a higher
  // severity inherited from an enabled category, quietly weakening what was already on.
  {
    rule: 'jsx-a11y/alt-text',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An image with no alt text is invisible to a screen reader.',
  },
  {
    rule: 'jsx-a11y/anchor-has-content',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A link with no accessible text cannot be announced or described.',
  },
  {
    rule: 'jsx-a11y/anchor-is-valid',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An anchor with no valid href is not reachable by keyboard.',
  },
  {
    rule: 'jsx-a11y/aria-props',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A misspelled ARIA attribute is ignored entirely rather than failing.',
  },
  {
    rule: 'jsx-a11y/aria-role',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An invalid role leaves the element with no announced semantics.',
  },
  {
    rule: 'jsx-a11y/click-events-have-key-events',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A click handler with no keyboard equivalent excludes keyboard users.',
  },
  {
    rule: 'jsx-a11y/heading-has-content',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An empty heading breaks the document outline screen readers navigate by.',
  },
  {
    rule: 'jsx-a11y/html-has-lang',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Without a lang attribute a screen reader guesses the pronunciation language.',
  },
  {
    rule: 'jsx-a11y/iframe-has-title',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An untitled iframe is announced to a screen reader only as a frame.',
  },
  {
    rule: 'jsx-a11y/img-redundant-alt',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Alt text that repeats the word image is announced twice.',
  },
  {
    rule: 'jsx-a11y/interactive-supports-focus',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An interactive element that cannot take focus is unreachable by keyboard.',
  },
  {
    rule: 'jsx-a11y/label-has-associated-control',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A label not bound to a control leaves the input unnamed.',
  },
  {
    rule: 'jsx-a11y/media-has-caption',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Media without captions excludes deaf and hard-of-hearing users.',
  },
  {
    rule: 'jsx-a11y/no-autofocus',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Autofocus moves focus without warning, disorienting screen reader users.',
  },
  {
    rule: 'jsx-a11y/role-has-required-aria-props',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A role missing its required attributes is announced incompletely.',
  },
  {
    rule: 'jsx-a11y/role-supports-aria-props',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An attribute unsupported by the role is silently ignored.',
  },
  {
    rule: 'jsx-a11y/tabindex-no-positive',
    level: 'paranoid',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A positive tabindex overrides document order and breaks the tab sequence.',
  },
  // Performance. `--performance` also reaches Oxlint's own `perf` category.
  {
    rule: 'oxc/no-accumulating-spread',
    level: 'strict',
    domains: ['performance'],
    severity: 'error',
    requires: [],
    reason: 'Spreading an accumulator inside a reduce makes the loop quadratic.',
  },
  {
    rule: 'no-await-in-loop',
    level: 'strict',
    domains: ['performance'],
    severity: 'warn',
    requires: [],
    reason: 'Awaiting inside a loop serialises work that could run concurrently.',
  },
  {
    rule: 'unicorn/prefer-set-has',
    level: 'strict',
    domains: ['performance'],
    severity: 'warn',
    requires: [],
    reason: 'Repeated `includes` over an array is a linear scan where a Set is constant.',
  },
  {
    rule: 'react/jsx-no-constructed-context-values',
    level: 'strict',
    domains: ['performance'],
    severity: 'error',
    requires: ['react', 'nextjs'],
    reason: 'A context value rebuilt each render re-renders every consumer.',
  },
  {
    rule: 'react-perf/jsx-no-new-object-as-prop',
    level: 'strict',
    domains: ['performance'],
    severity: 'warn',
    requires: ['react-dom'],
    reason: 'A fresh object prop each render defeats memoisation downstream.',
  },
  {
    rule: 'react-perf/jsx-no-new-array-as-prop',
    level: 'strict',
    domains: ['performance'],
    severity: 'warn',
    requires: ['react-dom'],
    reason: 'A fresh array prop each render defeats memoisation downstream.',
  },
  {
    rule: 'react-perf/jsx-no-new-function-as-prop',
    level: 'strict',
    domains: ['performance'],
    severity: 'warn',
    requires: ['react-dom'],
    reason: 'A fresh function prop each render defeats memoisation downstream.',
  },
  {
    rule: 'react-perf/jsx-no-jsx-as-prop',
    level: 'strict',
    domains: ['performance'],
    severity: 'warn',
    requires: ['react-dom'],
    reason: 'A JSX element built inline as a prop is a new object every render.',
  },
]

/**
 * Type-aware rules, which run on Oxlint's tsgolint engine.
 *
 * Gated on the `tsgolint` signal rather than merely on TypeScript: without the
 * `oxlint-tsgolint` package, `oxlint --type-aware` fails with "Failed to find tsgolint
 * executable", so configuring these without it would produce a config the project cannot
 * run. When TypeScript is present but tsgolint is not, the capability is surfaced as a
 * prerequisite instead.
 *
 * These are the whole of what tsgolint implements, spread across the level ladder by how
 * much existing code they tend to reject. `recommended` holds the rules that find genuinely
 * unsound code; `strict` holds the ones that are right but reject a lot of working code;
 * `paranoid` holds the whole-codebase policies. `basic` deliberately carries none - it is
 * the level for a project that wants the config to run fast and say little.
 *
 * Every rule here is checked against docs/tsgolint-rules.tsv, including its `implemented`
 * status, by the inventory conformance test.
 */
const TYPE_AWARE_RULES: Array<{
  rule: string
  severity: OxlintSeverity
  level: AuditLevel
  domains?: AuditDomain[]
  reason: string
}> = [
  {
    rule: 'typescript/no-floating-promises',
    severity: 'error',
    level: 'recommended',
    reason: 'An unawaited promise swallows its rejection, turning a failure into silence.',
  },
  {
    rule: 'typescript/await-thenable',
    severity: 'error',
    level: 'recommended',
    reason: 'Awaiting a non-promise is always a mistake and usually hides a missing call.',
  },
  {
    rule: 'typescript/no-misused-promises',
    severity: 'error',
    level: 'recommended',
    reason: 'Passing an async function where a void callback is expected drops its errors.',
  },
  {
    rule: 'typescript/no-array-delete',
    severity: 'error',
    level: 'recommended',
    reason: '`delete` on an array leaves a hole and does not shift the remaining elements.',
  },
  {
    rule: 'typescript/no-base-to-string',
    severity: 'error',
    level: 'recommended',
    reason:
      'Stringifying an object with no `toString` produces `[object Object]` in user-facing output.',
  },
  {
    rule: 'typescript/no-for-in-array',
    severity: 'error',
    level: 'recommended',
    reason: '`for...in` over an array yields string indices and any enumerable properties.',
  },
  {
    rule: 'typescript/no-implied-eval',
    severity: 'error',
    level: 'recommended',
    domains: ['security'],
    reason:
      'A string passed to a timer is evaluated as code, with type information proving the argument type.',
  },
  {
    rule: 'typescript/no-misused-spread',
    severity: 'error',
    level: 'recommended',
    reason:
      'Spreading a string, a Map, or a function produces something other than what the code implies.',
  },
  {
    rule: 'typescript/no-unsafe-argument',
    severity: 'error',
    level: 'recommended',
    reason: 'An `any` passed to a typed parameter voids every check that parameter exists for.',
  },
  {
    rule: 'typescript/no-unsafe-assignment',
    severity: 'error',
    level: 'recommended',
    reason: 'Assigning `any` to a typed binding spreads the hole outward.',
  },
  {
    rule: 'typescript/no-unsafe-call',
    severity: 'error',
    level: 'recommended',
    reason: 'Calling an `any` value fails at runtime with nothing having flagged it.',
  },
  {
    rule: 'typescript/no-unsafe-member-access',
    severity: 'error',
    level: 'recommended',
    reason: 'Reading a property off `any` returns `any`, so the hole propagates.',
  },
  {
    rule: 'typescript/no-unsafe-return',
    severity: 'error',
    level: 'recommended',
    reason: 'Returning `any` from a typed function lies to every caller.',
  },
  {
    rule: 'typescript/no-unsafe-enum-comparison',
    severity: 'error',
    level: 'recommended',
    reason: 'Comparing an enum against a raw literal silently fails when the enum value changes.',
  },
  {
    rule: 'typescript/no-unsafe-unary-minus',
    severity: 'error',
    level: 'recommended',
    reason: 'Unary minus on a non-number yields NaN rather than an error.',
  },
  {
    rule: 'typescript/only-throw-error',
    severity: 'error',
    level: 'recommended',
    reason: 'Throwing a non-Error loses the stack trace at the point it is most needed.',
  },
  {
    rule: 'typescript/prefer-promise-reject-errors',
    severity: 'error',
    level: 'recommended',
    reason: 'Rejecting with a non-Error loses the stack trace.',
  },
  {
    rule: 'typescript/require-await',
    severity: 'warn',
    level: 'recommended',
    reason: 'An async function with no await returns a promise for no reason and hides the intent.',
  },
  {
    rule: 'typescript/restrict-plus-operands',
    severity: 'error',
    level: 'recommended',
    reason: 'Adding mismatched types coerces silently, turning arithmetic into concatenation.',
  },
  {
    rule: 'typescript/unbound-method',
    severity: 'error',
    level: 'recommended',
    reason: 'A method passed as a value loses `this` and fails only when called.',
  },
  {
    rule: 'typescript/use-unknown-in-catch-callback-variable',
    severity: 'warn',
    level: 'recommended',
    reason: 'A typed catch parameter asserts something about a value that can be anything.',
  },
  {
    rule: 'typescript/no-mixed-enums',
    severity: 'error',
    level: 'recommended',
    reason: 'An enum mixing string and number members behaves inconsistently at runtime.',
  },
  {
    rule: 'typescript/related-getter-setter-pairs',
    severity: 'error',
    level: 'recommended',
    reason: 'A getter and setter with different types make the property lie in one direction.',
  },
  {
    rule: 'typescript/require-array-sort-compare',
    severity: 'error',
    level: 'recommended',
    reason: '`sort()` without a comparator sorts numbers lexicographically.',
  },
  {
    rule: 'typescript/switch-exhaustiveness-check',
    severity: 'error',
    level: 'recommended',
    reason: 'A switch missing a union member falls through silently when the union grows.',
  },
  {
    rule: 'typescript/no-deprecated',
    severity: 'warn',
    level: 'recommended',
    reason:
      'Calling an API its own author marked deprecated, which type information can see and syntax cannot.',
  },
  {
    rule: 'typescript/strict-void-return',
    severity: 'error',
    level: 'recommended',
    reason: 'Returning a value where void is expected means the caller silently discards it.',
  },
  {
    rule: 'typescript/no-confusing-void-expression',
    severity: 'warn',
    level: 'strict',
    reason: 'Using a void expression as a value reads as if it produced something.',
  },
  {
    rule: 'typescript/no-duplicate-type-constituents',
    severity: 'warn',
    level: 'strict',
    reason: 'A repeated union or intersection member is dead type code.',
  },
  {
    rule: 'typescript/no-redundant-type-constituents',
    severity: 'warn',
    level: 'strict',
    reason: 'A constituent absorbed by another makes the type mean less than it appears to.',
  },
  {
    rule: 'typescript/no-unnecessary-boolean-literal-compare',
    severity: 'warn',
    level: 'strict',
    reason: 'Comparing a boolean against a literal adds a step that changes nothing.',
  },
  {
    rule: 'typescript/no-unnecessary-type-arguments',
    severity: 'warn',
    level: 'strict',
    reason: 'A type argument identical to the default is noise.',
  },
  {
    rule: 'typescript/no-unnecessary-type-assertion',
    severity: 'warn',
    level: 'strict',
    reason: 'An assertion that changes no type is either redundant or hiding a stale assumption.',
  },
  {
    rule: 'typescript/no-unnecessary-type-conversion',
    severity: 'warn',
    level: 'strict',
    reason: 'Converting a value to the type it already has.',
  },
  {
    rule: 'typescript/no-unnecessary-template-expression',
    severity: 'warn',
    level: 'strict',
    reason: 'A template literal wrapping a string that is already a string.',
  },
  {
    rule: 'typescript/no-unnecessary-qualifier',
    severity: 'warn',
    level: 'strict',
    reason: 'A namespace qualifier that resolves to the enclosing scope.',
  },
  {
    rule: 'typescript/no-meaningless-void-operator',
    severity: 'warn',
    level: 'strict',
    reason: '`void` applied to something already void.',
  },
  {
    rule: 'typescript/no-useless-default-assignment',
    severity: 'warn',
    level: 'strict',
    reason: 'A default that can never be reached because the value is never undefined.',
  },
  {
    rule: 'typescript/non-nullable-type-assertion-style',
    severity: 'warn',
    level: 'strict',
    reason: '`as T` where `!` says the same thing more clearly.',
  },
  {
    rule: 'typescript/no-unsafe-type-assertion',
    severity: 'warn',
    level: 'strict',
    reason: 'An assertion to a more specific type, with type information proving it unchecked.',
  },
  {
    rule: 'typescript/prefer-find',
    severity: 'warn',
    level: 'strict',
    reason: '`filter(...)[0]` builds a whole array to read one element.',
  },
  {
    rule: 'typescript/prefer-includes',
    severity: 'warn',
    level: 'strict',
    reason: '`indexOf(x) !== -1` says `includes(x)` the long way.',
  },
  {
    rule: 'typescript/prefer-optional-chain',
    severity: 'warn',
    level: 'strict',
    reason: 'A chain of `&&` guards that `?.` expresses directly.',
  },
  {
    rule: 'typescript/prefer-nullish-coalescing',
    severity: 'warn',
    level: 'strict',
    reason: '`||` treats empty string and zero as absent; `??` does not.',
  },
  {
    rule: 'typescript/prefer-reduce-type-parameter',
    severity: 'warn',
    level: 'strict',
    reason: 'An asserted accumulator where a type parameter would be checked.',
  },
  {
    rule: 'typescript/prefer-regexp-exec',
    severity: 'warn',
    level: 'strict',
    reason: '`match` without a global flag does more work than `exec`.',
  },
  {
    rule: 'typescript/prefer-return-this-type',
    severity: 'warn',
    level: 'strict',
    reason: 'A builder returning its class name rather than `this` breaks subclass chaining.',
  },
  {
    rule: 'typescript/prefer-string-starts-ends-with',
    severity: 'warn',
    level: 'strict',
    reason: 'A regex or slice where `startsWith`/`endsWith` states the intent.',
  },
  {
    rule: 'typescript/promise-function-async',
    severity: 'warn',
    level: 'strict',
    reason:
      'A promise-returning function that is not async can throw synchronously, so callers need two error paths.',
  },
  {
    rule: 'typescript/restrict-template-expressions',
    severity: 'warn',
    level: 'strict',
    reason: 'Interpolating an object into a template produces `[object Object]`.',
  },
  {
    rule: 'typescript/return-await',
    severity: 'warn',
    level: 'strict',
    reason: '`return` without `await` inside a try block escapes the catch.',
  },
  {
    rule: 'typescript/consistent-type-exports',
    severity: 'warn',
    level: 'strict',
    reason: 'Mixing type and value exports defeats isolated transpilation.',
  },
  {
    rule: 'typescript/dot-notation',
    severity: 'warn',
    level: 'strict',
    reason:
      'Bracket access with a literal key, where dot access would be checked against the type.',
  },
  {
    rule: 'typescript/prefer-readonly',
    severity: 'warn',
    level: 'strict',
    reason: 'A private field never reassigned after construction.',
  },
  {
    rule: 'typescript/no-unnecessary-condition',
    severity: 'warn',
    level: 'paranoid',
    reason:
      'A condition the types prove is always true or always false. Very noisy where types are approximate.',
  },
  {
    rule: 'typescript/no-unnecessary-type-parameters',
    severity: 'warn',
    level: 'paranoid',
    reason: 'A type parameter used once, which could be its constraint instead.',
  },
  {
    rule: 'typescript/strict-boolean-expressions',
    severity: 'warn',
    level: 'paranoid',
    reason: 'Any non-boolean in a condition. A whole-codebase policy, not a defect.',
  },
  {
    rule: 'typescript/prefer-readonly-parameter-types',
    severity: 'warn',
    level: 'paranoid',
    reason: 'Every object parameter declared readonly. Fires across an entire codebase at once.',
  },
  {
    rule: 'typescript/consistent-return',
    severity: 'warn',
    level: 'paranoid',
    reason: 'Mixing bare `return` with returned values in one function.',
  },
]

/**
 * The js plugins shipped in `oxlint-audit-plugins`, and the stacks each one covers.
 *
 * These are custom plugins rather than built-ins, so they are loaded by path through
 * `jsPlugins`. Nothing here is recommended unless the package is actually present: a
 * `jsPlugins` entry pointing at a missing file makes Oxlint refuse to start, which is a
 * worse outcome than not configuring it at all.
 */
const AUDIT_PLUGINS: Array<{
  plugin: string
  requires: StackSignalId[]
  /** Domains that pull the plugin in even below the level that would reach it. */
  domains?: AuditDomain[]
  reason: string
  rules: Array<{ rule: string; severity: OxlintSeverity }>
}> = [
  {
    plugin: 'next-react',
    requires: ['nextjs', 'react'],
    reason: 'Next.js or React is in use, where these catch migration residue that still runs.',
    rules: [
      { rule: 'next-react/no-cache-primitive-outside-server-action', severity: 'error' },
      { rule: 'next-react/no-client-hooks-in-server-component', severity: 'error' },
      { rule: 'next-react/no-dynamic-before-interactive-script', severity: 'error' },
      { rule: 'next-react/no-edge-runtime', severity: 'warn' },
      { rule: 'next-react/no-legacy-context-provider', severity: 'warn' },
      { rule: 'next-react/no-legacy-next-modules', severity: 'error' },
      { rule: 'next-react/no-middleware-file', severity: 'warn' },
      { rule: 'next-react/no-removed-next-config-keys', severity: 'error' },
      { rule: 'next-react/require-await-next-request-apis', severity: 'error' },
    ],
  },
  {
    plugin: 'data-layer',
    requires: ['zod', 'tanstack-query', 'zustand', 'react-hook-form', 'drizzle'],
    reason:
      'A validation or data-fetching library is in use, where a stale option is ignored rather than rejected.',
    rules: [
      { rule: 'data-layer/no-drizzle-legacy-api', severity: 'error' },
      { rule: 'data-layer/no-field-array-index-key', severity: 'error' },
      { rule: 'data-layer/no-react-query-removed-exports', severity: 'error' },
      { rule: 'data-layer/no-react-query-v4-options', severity: 'error' },
      { rule: 'data-layer/no-rhf-setvalue-loop', severity: 'warn' },
      { rule: 'data-layer/no-zod-legacy-error-params', severity: 'error' },
      { rule: 'data-layer/no-zod-removed-methods', severity: 'error' },
      { rule: 'data-layer/no-zod-safe-parse-json-parse', severity: 'error' },
      { rule: 'data-layer/no-zod-shape-spread-drops-refinements', severity: 'error' },
      { rule: 'data-layer/no-zod-single-arg-record', severity: 'warn' },
      { rule: 'data-layer/no-zod-string-format-methods', severity: 'warn' },
      { rule: 'data-layer/no-zod-to-json-schema-package', severity: 'error' },
      { rule: 'data-layer/no-zod-trim-after-min-length', severity: 'error' },
      { rule: 'data-layer/no-zustand-v4-import-paths', severity: 'error' },
      { rule: 'data-layer/require-async-parse-for-async-schema', severity: 'error' },
      { rule: 'data-layer/require-zustand-curried-create', severity: 'error' },
    ],
  },
  {
    plugin: 'ai-integrations',
    requires: ['ai-sdk', 'stripe'],
    reason: 'The AI SDK or Stripe is in use, where an unverified webhook is a security finding.',
    rules: [
      { rule: 'ai-integrations/no-ai-v6-exports', severity: 'error' },
      { rule: 'ai-integrations/no-ai-v6-options', severity: 'error' },
      { rule: 'ai-integrations/no-ai-v6-result-members', severity: 'error' },
      { rule: 'ai-integrations/no-stripe-unverified-webhook', severity: 'error' },
      { rule: 'ai-integrations/no-stripe-v21-api', severity: 'error' },
      { rule: 'ai-integrations/require-stripe-async-webhook', severity: 'error' },
    ],
  },
  {
    plugin: 'ts-tooling',
    requires: ['vitest', 'vite'],
    reason: 'Vitest or Vite is in use, where a removed config key is silently ignored.',
    rules: [
      { rule: 'ts-tooling/no-removed-vitest-config', severity: 'error' },
      { rule: 'ts-tooling/no-removed-vitest-exports', severity: 'error' },
    ],
  },
  {
    plugin: 'supabase',
    domains: ['security'],
    requires: ['supabase'],
    reason:
      'Supabase is in use, where a server-side `getSession()` trusts a forgeable cookie and an undestructured `error` hides an RLS denial.',
    rules: [
      { rule: 'supabase/no-browser-client-on-server', severity: 'error' },
      { rule: 'supabase/no-deprecated-auth-helpers', severity: 'error' },
      { rule: 'supabase/no-get-session-for-authorization', severity: 'error' },
      { rule: 'supabase/no-module-scope-server-client', severity: 'error' },
      { rule: 'supabase/require-error-check', severity: 'error' },
    ],
  },
  {
    plugin: 'web-security',
    domains: ['security'],
    // Stack-agnostic: these apply to any JavaScript or TypeScript project, so the signals
    // listed here are the ones that establish there is source to lint at all.
    requires: ['typescript', 'node', 'esm', 'react', 'vue', 'svelte', 'astro'],
    reason: 'Applies to any JavaScript or TypeScript source: OWASP Top 10:2025 checks.',
    rules: [
      { rule: 'web-security/no-hardcoded-credential', severity: 'error' },
      { rule: 'web-security/no-insecure-randomness', severity: 'error' },
      { rule: 'web-security/no-shell-injection', severity: 'error' },
      { rule: 'web-security/require-sanitized-html', severity: 'error' },
    ],
  },
  {
    plugin: 'slop-stop',
    requires: ['typescript'],
    reason: 'TypeScript is in use, so code that discards its own type evidence is detectable.',
    rules: [
      { rule: 'slop-stop/no-chained-type-assertions', severity: 'error' },
      { rule: 'slop-stop/no-widen-then-assert', severity: 'error' },
      { rule: 'slop-stop/no-known-value-widening', severity: 'warn' },
      { rule: 'slop-stop/no-unsafe-dictionary-type', severity: 'warn' },
      // Fires on every pre-existing assertion in a repository that has never used the
      // convention, so it is never recommended. Listed in the package README instead.
    ],
  },
]

/**
 * Where the plugin package lives, read from the evidence that detected it.
 *
 * A vendored copy and an installed dependency need different `jsPlugins` paths, and
 * guessing wrong produces a config Oxlint cannot load.
 */
function auditPluginSpecifier(stack: ProjectStack, plugin: string): string {
  const signal = stack.signals.find(({ id }) => id === 'audit-plugins')
  const vendored = signal?.evidence.some(({ kind }) => kind === 'config-file') ?? false

  // A dependency is named, not pathed. Oxlint resolves a bare specifier through the
  // package's `exports` map, which is what keeps the config working when the package
  // reorganises its files and under package managers that do not hoist into a flat
  // `node_modules`. Reaching into `node_modules/.../src` would bypass both.
  return vendored
    ? `./tools/oxlint/audit-plugins/${plugin}/index.ts`
    : `oxlint-audit-plugins/${plugin}`
}

/**
 * Builds the full set of recommendations for a stack.
 *
 * This is a pure function of the stack: the same signals always produce the same
 * recommendations, in the same order.
 */
export function recommendForStack(
  stack: ProjectStack,
  request: AuditRequest = DEFAULT_REQUEST,
): Recommendation[] {
  const recommendations: Recommendation[] = []
  // `--dom` is not a separate mode. It resolves to the top of the ladder with every domain
  // on, so one code path decides everything and `--dom` stays explainable as a shorthand.
  const level: AuditLevel = request.maximal ? 'paranoid' : request.level
  const domains = new Set<AuditDomain>(request.maximal ? AUDIT_DOMAINS : request.domains)

  /** A rule is in when the level reaches it, or when one of its domains was asked for. */
  const wanted = (entry: { level: AuditLevel; domains?: AuditDomain[] }): boolean =>
    meetsLevel(level, entry.level) || (entry.domains ?? []).some((domain) => domains.has(domain))

  for (const { plugin, requires, reason } of PLUGIN_RULES) {
    const triggeredBy = requires.filter((signal) => hasSignal(stack, signal))

    if (triggeredBy.length > 0) {
      recommendations.push({ kind: 'plugin', target: plugin, reason, triggeredBy })
    }
  }

  for (const entry of LEVEL_CATEGORIES) {
    // Domains reach categories as well as rules: `--performance` is meaningless if it
    // enables four perf rules but leaves Oxlint's own `perf` category off.
    if (!wanted(entry)) {
      continue
    }

    const askedByDomain = (entry.domains ?? []).find((domain) => domains.has(domain))

    recommendations.push({
      kind: 'category',
      target: entry.category,
      severity: entry.severity,
      reason: meetsLevel(level, entry.level)
        ? entry.level === 'basic'
          ? `Oxlint's only default category, stated explicitly so the config does not depend on that default.`
          : `The ${level} level reaches Oxlint's ${entry.category} category.`
        : `The ${askedByDomain ?? ''} rule set covers Oxlint's ${entry.category} category.`,
      triggeredBy: [],
    })
  }

  for (const entry of TARGETED_RULES) {
    const triggeredBy = entry.requires.filter((signal) => hasSignal(stack, signal))

    if (entry.requires.length > 0 && triggeredBy.length === 0) {
      continue
    }

    if (!wanted(entry)) {
      continue
    }

    recommendations.push({
      kind: 'rule',
      target: entry.rule,
      severity: entry.severity,
      reason: entry.reason,
      triggeredBy,
    })
  }

  if (hasSignal(stack, 'tsgolint') && hasSignal(stack, 'tsconfig')) {
    const typeAware = TYPE_AWARE_RULES.filter(wanted)

    // The option is what makes Oxlint load the engine at all, so it is pointless without
    // at least one rule to run - `--basic` carries none.
    if (typeAware.length > 0) {
      recommendations.push({
        kind: 'option',
        target: 'typeAware',
        reason:
          'oxlint-tsgolint is installed, so the type-aware rules can run; the option has to be on for Oxlint to load them.',
        triggeredBy: ['tsgolint', 'tsconfig'],
      })
    }

    for (const entry of typeAware) {
      recommendations.push({
        kind: 'rule',
        target: entry.rule,
        severity: entry.severity,
        reason: entry.reason,
        triggeredBy: ['tsgolint'],
      })
    }
  }

  // Both halves are required: the sources to point at, and the runtime they import. A
  // `jsPlugins` entry without `@oxlint/plugins` installed makes Oxlint fail to start, which
  // would leave the project worse off than having no custom rules at all.
  if (hasSignal(stack, 'audit-plugins') && hasSignal(stack, 'oxlint-plugins')) {
    for (const { plugin, requires, reason, rules, domains: pluginDomains } of AUDIT_PLUGINS) {
      const triggeredBy = requires.filter((signal) => hasSignal(stack, signal))

      if (triggeredBy.length === 0) {
        continue
      }

      // A js plugin has no level of its own: its rules target defects rather than taste,
      // so the only question is whether the stack justifies it. A domain flag can pull one
      // in that the level would not have reached.
      const askedFor =
        pluginDomains === undefined || pluginDomains.some((domain) => domains.has(domain))

      if (!askedFor && !meetsLevel(level, 'recommended')) {
        continue
      }

      recommendations.push({
        kind: 'js-plugin',
        target: plugin,
        specifier: auditPluginSpecifier(stack, plugin),
        reason,
        triggeredBy,
      })

      for (const { rule, severity } of rules) {
        recommendations.push({
          kind: 'rule',
          target: rule,
          severity,
          reason: `Part of the ${plugin} plugin, which this project's stack justifies.`,
          triggeredBy,
        })
      }
    }
  }

  return recommendations
}

/**
 * Capabilities the project could adopt but has not installed the tooling for.
 *
 * Reported instead of configured: writing type-aware config without the engine would
 * produce a config that fails at run time.
 */
export function findPrerequisites(stack: ProjectStack): Prerequisite[] {
  const prerequisites: Prerequisite[] = []

  if (hasSignal(stack, 'tsconfig') && !hasSignal(stack, 'tsgolint')) {
    prerequisites.push({
      capability: 'Type-aware linting',
      reason: `${TYPE_AWARE_RULES.length} type-aware rules (including no-floating-promises) need type information, which Oxlint gets from the tsgolint engine.`,
      install: 'pnpm add -D oxlint-tsgolint',
    })
  }

  if (!hasSignal(stack, 'audit-plugins') || !hasSignal(stack, 'oxlint-plugins')) {
    const applicable = AUDIT_PLUGINS.filter(({ requires }) =>
      requires.some((signal) => hasSignal(stack, signal)),
    ).map(({ plugin }) => plugin)

    if (applicable.length > 0) {
      prerequisites.push({
        capability: `Stack-specific audit rules (${applicable.join(', ')})`,
        // One install is enough: the package declares `@oxlint/plugins` as a dependency, so
        // the runtime every plugin imports arrives with it.
        reason: `This project's dependencies match ${applicable.length} of the audit plugins, which catch deprecated APIs and migration residue that still type-checks and still runs.`,
        install: hasSignal(stack, 'audit-plugins')
          ? 'pnpm add -D @oxlint/plugins'
          : 'pnpm add -D oxlint-audit-plugins',
      })
    }
  }

  // Oxlint parses these files and applies its universal rules, but ships no dedicated
  // plugin for either, so there is nothing framework-specific to recommend.
  for (const framework of ['svelte', 'astro'] as const) {
    if (hasSignal(stack, framework)) {
      prerequisites.push({
        capability: `${framework === 'svelte' ? 'Svelte' : 'Astro'}-specific rules`,
        reason: `Oxlint lints the script blocks in .${framework} files with its universal rules, but ships no ${framework} plugin, so no framework-specific rules are available yet.`,
        install: '(nothing to install - tracked upstream)',
      })
    }
  }

  return prerequisites
}

/** Type-aware rule names this recommender can emit, for tsgolint inventory checks. */
export function getTypeAwareRuleNames(): string[] {
  return TYPE_AWARE_RULES.map(({ rule }) => rule)
}

/** Every Oxlint rule name this recommender can emit, for inventory conformance checks. */
export function getRecommendableRuleNames(): string[] {
  return [...TARGETED_RULES.map(({ rule }) => rule), ...TYPE_AWARE_RULES.map(({ rule }) => rule)]
}

/** Every plugin this recommender can enable. */
export function getRecommendablePlugins(): OxlintBuiltinPlugin[] {
  return PLUGIN_RULES.map(({ plugin }) => plugin)
}

/**
 * Every js-plugin rule this recommender can emit, with its owning plugin.
 *
 * Deliberately separate from {@link getRecommendableRuleNames}: these rules come from
 * `oxlint-audit-plugins`, not from Oxlint, so they are absent from the built-in inventory
 * and are checked against the plugin package instead.
 */
export function getAuditPluginRules(): Array<{ plugin: string; rules: string[] }> {
  return AUDIT_PLUGINS.map(({ plugin, rules }) => ({
    plugin,
    rules: rules.map(({ rule }) => rule),
  }))
}
