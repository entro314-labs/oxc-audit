import { installCommand } from './package-updater.js'
import { AUDIT_PLUGINS_PACKAGE, hasFrameworkFormatter, hasSignal } from './stack-detector.js'
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
    // Oxlint 1.79 replaced the single `react/react-compiler` rule with 22 rules driven by the
    // React Compiler's own validation passes, spread across the categories. Enabling this
    // plugin is all it takes: 12 of them sit in `correctness`, so every level gets them, and
    // four more arrive with `suspicious` at `recommended`. None is named individually below.
    // Promoting the `suspicious` ones would only double-report - `exhaustive-effect-dependencies`
    // and `memo-dependencies` cover the ground `react/exhaustive-deps` already covers from
    // `correctness`, and `react/hooks` covers `react/rules-of-hooks`. Silencing either side
    // would mean writing an `off` with no evidence that the rule is wrong for the project,
    // and both sides are right; which one to keep is the project's call.
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

/**
 * Runtime environments, declared from the evidence that code runs there.
 *
 * Oxlint knows only the ECMAScript globals unless `env` says otherwise, and several rules
 * key off the globals an environment defines: without `browser` or `node`,
 * `no-implied-eval` does not recognise a bare `setTimeout("...")` as a timer, and
 * `no-global-assign` does not protect `window` or `process`. Declaring an environment
 * adds no rule of its own, so it costs nothing where it is right. `no-undef`, the rule
 * that would turn a wrong declaration into noise, is in `nursery` and never enabled.
 */
const ENV_RULES: Array<{ env: string; requires: StackSignalId[]; reason: string }> = [
  {
    env: 'browser',
    requires: ['react-dom', 'nextjs', 'vue', 'svelte', 'astro', 'vite'],
    reason:
      'This code renders in a browser, so its globals are declared and the rules that key off them, like no-implied-eval on a bare setTimeout, can see them.',
  },
  {
    env: 'node',
    requires: ['node'],
    reason:
      'This code runs on Node, so its globals are declared and the rules that key off them, like no-global-assign on process, can see them.',
  },
]

/**
 * Ignore patterns for the minified files the scan found.
 *
 * Linting generated or vendored code reports thousands of findings nobody will fix - one
 * minified worker in `public/` produced 45,000 of a project's 46,000. Every `.min.js`
 * collapses into one glob; any other minified file is named exactly, so nothing
 * hand-written is caught by a pattern broader than the evidence.
 */
export function minifiedIgnorePatterns(stack: ProjectStack): string[] {
  const named = stack.minifiedFiles.filter((path) => !path.endsWith('.min.js'))

  return [...(stack.minifiedFiles.length > named.length ? ['**/*.min.js'] : []), ...named]
}

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
 * A category enables every rule in it, type-aware ones included once `typeAware` is on, so
 * a rule is listed at the level where its category starts it rather than where it would
 * ideally sit; the conformance tests hold every row to that. With Oxlint's current
 * categories that leaves `paranoid` adding nothing to `strict`: the policies it once held,
 * like `strict-boolean-expressions`, arrive with `pedantic`.
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
  /**
   * An audit plugin whose rules cover the same ground more precisely. When that plugin is
   * recommended, this rule is not: the two would contradict each other.
   */
  supersededBy?: string
  /** Rule options, written only when the config does not already name the rule. */
  options?: unknown[]
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
    // An `off` on evidence the rule cannot apply. `suspicious` carries `react-in-jsx-scope`, which demands
    // a `React` binding the automatic runtime never needs, so on a React 17+ project the
    // `recommended` config would report every component file. Oxlint has no runtime setting
    // that quietens it, so the rule is turned off on the evidence that it cannot apply. Any
    // explicit value the project set, including a re-enable, is left alone.
    rule: 'react/react-in-jsx-scope',
    level: 'recommended',
    severity: 'off',
    requires: ['react-jsx-runtime'],
    reason:
      'The automatic JSX runtime imports `react/jsx-runtime` itself, so requiring `React` in scope reports every component for a binding that is never used.',
  },
  {
    // On at `error` from `correctness` already; named for its options. Oxlint ignores
    // `_`-prefixed arguments by default but drops that default as soon as any option is set,
    // and never ignores a bare `_` in `[_, value]`, the idiom for skipping a tuple slot.
    // Unused imports are removed by `--fix`: Oxlint classes that fix as safe.
    rule: 'no-unused-vars',
    level: 'basic',
    severity: 'error',
    requires: [],
    options: [
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
        fix: { imports: 'safe-fix', variables: 'suggestion' },
      },
    ],
    reason:
      'Unused code, with the `_` prefix honoured everywhere as the way to mark something unused on purpose, and unused imports removed by --fix.',
  },
  {
    // Both test runners name a suite after a function or class - `describe(parseConfig, ...)`
    // - which the rule otherwise reports as a non-string title.
    rule: 'vitest/valid-title',
    level: 'basic',
    severity: 'error',
    requires: ['vitest'],
    options: [{ ignoreTypeOfDescribeName: true }],
    reason: 'A malformed test title, allowing a function or class as a suite name.',
  },
  {
    rule: 'jest/valid-title',
    level: 'basic',
    severity: 'error',
    requires: ['jest'],
    options: [{ ignoreTypeOfDescribeName: true }],
    reason: 'A malformed test title, allowing a function or class as a suite name.',
  },
  {
    // On from `suspicious`; named for its options. These modules exist to be imported for
    // their effect alone - `server-only` is how a Next.js module refuses to reach the client.
    rule: 'import/no-unassigned-import',
    level: 'recommended',
    severity: 'warn',
    requires: ['esm', 'typescript'],
    options: [
      {
        allow: [
          '**/*.css',
          '**/*.scss',
          '**/*.sass',
          '**/*.less',
          'server-only',
          'client-only',
          'dotenv/config',
          'reflect-metadata',
          '@testing-library/jest-dom',
          '@testing-library/jest-dom/*',
        ],
      },
    ],
    reason:
      'An import kept only for its side effects, allowing stylesheets and the modules that exist to be imported that way.',
  },
  // Three more `off`s, for rules Oxlint's categories enable that were measured as noise
  // across real projects: almost every finding was an idiom, not a defect. Written only into
  // a gap, so a project that wants one of them keeps it.
  {
    rule: 'unicorn/consistent-function-scoping',
    level: 'recommended',
    severity: 'off',
    requires: [],
    reason:
      'Reports every helper defined inside a component or closure, with no fix; on real projects that was nearly all it found.',
  },
  {
    rule: 'no-underscore-dangle',
    level: 'recommended',
    severity: 'off',
    requires: [],
    reason:
      'Reports the `_private` naming convention and injected globals such as `__SW_MANIFEST`, which is all it found on real projects.',
  },
  {
    rule: 'vitest/require-mock-type-parameters',
    level: 'basic',
    severity: 'off',
    requires: ['vitest'],
    reason:
      'Reports every untyped `vi.fn()`. A typing preference that Oxlint files under correctness, so it would run even at --basic.',
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
    // Bans the prop outright. `web-security/require-sanitized-html` permits the sanitised
    // form, so once that plugin is in this rule would report every legitimate rich-text
    // render the plugin rule had deliberately allowed.
    rule: 'react/no-danger',
    level: 'basic',
    domains: ['security'],
    severity: 'error',
    requires: ['react'],
    supersededBy: 'web-security',
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
  // Accessibility. All of these are in Oxlint's `correctness` category, so they run at
  // `error` from `basic` wherever JSX is detected and the `jsx-a11y` plugin is on; they are
  // listed there, and naming them states what the category already does. Recommended at
  // `error` rather than `warn`: a rule-level `warn` would override the category's severity.
  {
    rule: 'jsx-a11y/alt-text',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An image with no alt text is invisible to a screen reader.',
  },
  {
    rule: 'jsx-a11y/anchor-has-content',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A link with no accessible text cannot be announced or described.',
  },
  {
    rule: 'jsx-a11y/anchor-is-valid',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An anchor with no valid href is not reachable by keyboard.',
  },
  {
    rule: 'jsx-a11y/aria-props',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A misspelled ARIA attribute is ignored entirely rather than failing.',
  },
  {
    rule: 'jsx-a11y/aria-role',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An invalid role leaves the element with no announced semantics.',
  },
  {
    rule: 'jsx-a11y/click-events-have-key-events',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A click handler with no keyboard equivalent excludes keyboard users.',
  },
  {
    rule: 'jsx-a11y/heading-has-content',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An empty heading breaks the document outline screen readers navigate by.',
  },
  {
    rule: 'jsx-a11y/html-has-lang',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Without a lang attribute a screen reader guesses the pronunciation language.',
  },
  {
    rule: 'jsx-a11y/iframe-has-title',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An untitled iframe is announced to a screen reader only as a frame.',
  },
  {
    rule: 'jsx-a11y/img-redundant-alt',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Alt text that repeats the word image is announced twice.',
  },
  {
    rule: 'jsx-a11y/interactive-supports-focus',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An interactive element that cannot take focus is unreachable by keyboard.',
  },
  {
    rule: 'jsx-a11y/label-has-associated-control',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A label not bound to a control leaves the input unnamed.',
  },
  {
    rule: 'jsx-a11y/media-has-caption',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Media without captions excludes deaf and hard-of-hearing users.',
  },
  {
    rule: 'jsx-a11y/no-autofocus',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'Autofocus moves focus without warning, disorienting screen reader users.',
  },
  {
    rule: 'jsx-a11y/role-has-required-aria-props',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'A role missing its required attributes is announced incompletely.',
  },
  {
    rule: 'jsx-a11y/role-supports-aria-props',
    level: 'basic',
    domains: ['accessibility'],
    severity: 'error',
    requires: ['jsx'],
    reason: 'An attribute unsupported by the role is silently ignored.',
  },
  {
    rule: 'jsx-a11y/tabindex-no-positive',
    level: 'basic',
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
 * These are the whole of what tsgolint implements, spread across the level ladder.
 * `recommended` holds the rules that find genuinely unsound code, plus what `correctness`
 * and `suspicious` run once `typeAware` is on; `strict` holds what `pedantic` runs and the
 * named style rules, which are right but reject a lot of working code. `basic` deliberately
 * carries none - it is the level for a project that wants the config to run fast and say
 * little.
 *
 * Every rule here is checked against docs/tsgolint-rules.tsv, including its `implemented`
 * status, by the inventory conformance test.
 */
const TYPE_AWARE_RULES: Array<{
  rule: string
  severity: OxlintSeverity
  level: AuditLevel
  domains?: AuditDomain[]
  options?: unknown[]
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
    // JSX attributes are exempt. `onClick={async () => ...}` is how React handlers are
    // written, React ignores the returned promise by design, and every finding the rule made
    // across real Next.js projects was one of these.
    rule: 'typescript/no-misused-promises',
    severity: 'error',
    level: 'recommended',
    options: [{ checksVoidReturn: { attributes: false } }],
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
  // These five sit in Oxlint's `correctness` category, which every level enables at `error`,
  // so they run the moment `typeAware` is on. Naming them at anything below `error` would
  // override the category and quietly weaken a check that was already active.
  {
    rule: 'typescript/no-duplicate-type-constituents',
    severity: 'error',
    level: 'recommended',
    reason: 'A repeated union or intersection member is dead type code.',
  },
  {
    rule: 'typescript/no-redundant-type-constituents',
    severity: 'error',
    level: 'recommended',
    reason: 'A constituent absorbed by another makes the type mean less than it appears to.',
  },
  {
    rule: 'typescript/no-meaningless-void-operator',
    severity: 'error',
    level: 'recommended',
    reason: '`void` applied to something already void.',
  },
  {
    rule: 'typescript/no-useless-default-assignment',
    severity: 'error',
    level: 'recommended',
    reason: 'A default that can never be reached because the value is never undefined.',
  },
  {
    rule: 'typescript/restrict-template-expressions',
    severity: 'error',
    level: 'recommended',
    reason: 'Interpolating an object into a template produces `[object Object]`.',
  },
  // These eight sit in `suspicious`, which `recommended` enables, so they run there whether
  // or not they are named; they are listed at the level where they actually start.
  {
    rule: 'typescript/no-unnecessary-boolean-literal-compare',
    severity: 'warn',
    level: 'recommended',
    reason: 'Comparing a boolean against a literal adds a step that changes nothing.',
  },
  {
    rule: 'typescript/no-unnecessary-type-arguments',
    severity: 'warn',
    level: 'recommended',
    reason: 'A type argument identical to the default is noise.',
  },
  {
    rule: 'typescript/no-unnecessary-type-assertion',
    severity: 'warn',
    level: 'recommended',
    reason: 'An assertion that changes no type is either redundant or hiding a stale assumption.',
  },
  {
    rule: 'typescript/no-unnecessary-type-conversion',
    severity: 'warn',
    level: 'recommended',
    reason: 'Converting a value to the type it already has.',
  },
  {
    rule: 'typescript/no-unnecessary-template-expression',
    severity: 'warn',
    level: 'recommended',
    reason: 'A template literal wrapping a string that is already a string.',
  },
  {
    rule: 'typescript/no-unsafe-type-assertion',
    severity: 'warn',
    level: 'recommended',
    reason: 'An assertion to a more specific type, with type information proving it unchecked.',
  },
  {
    rule: 'typescript/no-unnecessary-type-parameters',
    severity: 'warn',
    level: 'recommended',
    reason: 'A type parameter used once, which could be its constraint instead.',
  },
  {
    rule: 'typescript/consistent-return',
    severity: 'warn',
    level: 'recommended',
    reason: 'Mixing bare `return` with returned values in one function.',
  },
  {
    rule: 'typescript/no-confusing-void-expression',
    severity: 'warn',
    level: 'strict',
    reason: 'Using a void expression as a value reads as if it produced something.',
  },
  {
    rule: 'typescript/no-unnecessary-qualifier',
    severity: 'warn',
    level: 'strict',
    reason: 'A namespace qualifier that resolves to the enclosing scope.',
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
    rule: 'typescript/strict-boolean-expressions',
    severity: 'warn',
    level: 'strict',
    reason: 'Any non-boolean in a condition. A whole-codebase policy, not a defect.',
  },
  {
    rule: 'typescript/prefer-readonly-parameter-types',
    severity: 'warn',
    level: 'strict',
    reason: 'Every object parameter declared readonly. Fires across an entire codebase at once.',
  },
]

/**
 * Syntax-only rules and the type-aware rule that checks the same thing with type
 * information. With both on, one line is reported twice, and the type-aware twin is the more
 * precise of the two, so when it is recommended the syntax-only one is written `off` into a
 * gap. That `off` stays if `typeAware` is later turned off; delete it to get the syntax-only
 * check back.
 */
const TYPE_AWARE_TWINS: Record<string, string> = {
  'no-implied-eval': 'typescript/no-implied-eval',
  'no-throw-literal': 'typescript/only-throw-error',
  'prefer-promise-reject-errors': 'typescript/prefer-promise-reject-errors',
  'require-await': 'typescript/require-await',
  'unicorn/prefer-array-find': 'typescript/prefer-find',
  'unicorn/prefer-string-starts-ends-with': 'typescript/prefer-string-starts-ends-with',
}

/**
 * Test files, as the two runners find them by default.
 */
const TEST_FILES = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/tests/**', '**/test/**']

/**
 * Type-aware rules turned off in test files.
 *
 * Mocks are `any` by construction - `vi.fn()` and `jest.fn()` return one unless given type
 * parameters - so every call, property read and assertion on a mock is reported. Measured
 * across real projects, test files produced over ninety percent of these rules' findings,
 * almost none of them defects. Source files keep the rules.
 */
const TEST_FILE_EXEMPTIONS = [
  'typescript/no-unsafe-argument',
  'typescript/no-unsafe-assignment',
  'typescript/no-unsafe-call',
  'typescript/no-unsafe-member-access',
  'typescript/no-unsafe-return',
  'typescript/no-unsafe-type-assertion',
]

/**
 * The js plugins shipped in `@entro314labs/oxlint-audit-plugins`, and the stacks each one covers.
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
 * The `jsPlugins` specifier for a plugin: the package name, not a path. Oxlint resolves a
 * bare specifier through the package's `exports` map, which is what keeps the config working
 * when the package reorganises its files and under package managers that do not hoist into
 * a flat `node_modules`. Reaching into `node_modules/...` would bypass both.
 */
function auditPluginSpecifier(plugin: string): string {
  return `${AUDIT_PLUGINS_PACKAGE}/${plugin}`
}

/** The level and domains a request resolves to. */
interface ResolvedRequest {
  level: AuditLevel
  domains: Set<AuditDomain>
}

/**
 * `--dom` is not a separate mode. It resolves to the top of the ladder with every domain
 * on, so one code path decides everything and `--dom` stays explainable as a shorthand.
 */
function resolveRequest(request: AuditRequest): ResolvedRequest {
  return {
    level: request.maximal ? 'paranoid' : request.level,
    domains: new Set<AuditDomain>(request.maximal ? AUDIT_DOMAINS : request.domains),
  }
}

/** A rule is in when the level reaches it, or when one of its domains was asked for. */
function isWanted(
  { level, domains }: ResolvedRequest,
  entry: { level: AuditLevel; domains?: AuditDomain[] },
): boolean {
  return (
    meetsLevel(level, entry.level) || (entry.domains ?? []).some((domain) => domains.has(domain))
  )
}

/**
 * The audit plugins the stack justifies and the request reaches, each with the signals
 * behind it. Shared by the recommendations and the prerequisites so the two agree on
 * which plugins a run would actually use.
 */
function selectAuditPlugins(
  stack: ProjectStack,
  resolved: ResolvedRequest,
): Array<(typeof AUDIT_PLUGINS)[number] & { triggeredBy: StackSignalId[] }> {
  return AUDIT_PLUGINS.flatMap((entry) => {
    const triggeredBy = entry.requires.filter((signal) => hasSignal(stack, signal))

    if (triggeredBy.length === 0) {
      return []
    }

    // A js plugin has no level of its own: its rules target defects rather than taste, so
    // the only question is whether the stack justifies it. A domain flag can pull one in
    // that the level would not have reached.
    const askedFor =
      entry.domains === undefined || entry.domains.some((domain) => resolved.domains.has(domain))

    if (!askedFor && !meetsLevel(resolved.level, 'recommended')) {
      return []
    }

    return [{ ...entry, triggeredBy }]
  })
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
  const resolved = resolveRequest(request)
  const { level } = resolved
  const wanted = (entry: { level: AuditLevel; domains?: AuditDomain[] }): boolean =>
    isWanted(resolved, entry)

  // Gated on the package being a dependency: it declares `@oxlint/plugins`, the runtime every
  // plugin imports, so installing it is enough, and a `jsPlugins` entry without it makes
  // Oxlint refuse to start.
  const auditPlugins = hasSignal(stack, 'audit-plugins') ? selectAuditPlugins(stack, resolved) : []
  const auditPluginNames = new Set(auditPlugins.map(({ plugin }) => plugin))

  for (const { plugin, requires, reason } of PLUGIN_RULES) {
    const triggeredBy = requires.filter((signal) => hasSignal(stack, signal))

    if (triggeredBy.length > 0) {
      recommendations.push({ kind: 'plugin', target: plugin, reason, triggeredBy })
    }
  }

  for (const pattern of minifiedIgnorePatterns(stack)) {
    recommendations.push({
      kind: 'ignore',
      target: pattern,
      reason:
        'Minified - a line over 1,000 characters - so generated or vendored code that no rule here was written for.',
      triggeredBy: [],
    })
  }

  for (const { env, requires, reason } of ENV_RULES) {
    const triggeredBy = requires.filter((signal) => hasSignal(stack, signal))

    if (triggeredBy.length > 0) {
      recommendations.push({ kind: 'env', target: env, reason, triggeredBy })
    }
  }

  for (const entry of LEVEL_CATEGORIES) {
    // Domains reach categories as well as rules: `--performance` is meaningless if it
    // enables four perf rules but leaves Oxlint's own `perf` category off.
    if (!wanted(entry)) {
      continue
    }

    const askedByDomain = (entry.domains ?? []).find((domain) => resolved.domains.has(domain))

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

  const typeAwareRows =
    hasSignal(stack, 'tsgolint') && hasSignal(stack, 'tsconfig')
      ? TYPE_AWARE_RULES.filter(wanted)
      : []
  const typeAwareTwins = new Set(typeAwareRows.map(({ rule }) => rule))

  for (const entry of TARGETED_RULES) {
    const triggeredBy = entry.requires.filter((signal) => hasSignal(stack, signal))

    // Its type-aware twin replaces it; see TYPE_AWARE_TWINS.
    if (typeAwareTwins.has(TYPE_AWARE_TWINS[entry.rule] ?? '')) {
      continue
    }

    if (entry.requires.length > 0 && triggeredBy.length === 0) {
      continue
    }

    if (!wanted(entry)) {
      continue
    }

    if (entry.supersededBy !== undefined && auditPluginNames.has(entry.supersededBy)) {
      continue
    }

    recommendations.push({
      kind: 'rule',
      target: entry.rule,
      severity: entry.severity,
      ...(entry.options && { options: entry.options }),
      reason: entry.reason,
      triggeredBy,
    })
  }

  if (typeAwareTwins.size > 0) {
    for (const [plain, twin] of Object.entries(TYPE_AWARE_TWINS)) {
      if (typeAwareTwins.has(twin)) {
        recommendations.push({
          kind: 'rule',
          target: plain,
          severity: 'off',
          reason: `${twin} checks the same thing with type information, so with both on each finding is reported twice.`,
          triggeredBy: ['tsgolint'],
        })
      }
    }
  }

  if (typeAwareRows.length > 0) {
    const typeAware = typeAwareRows

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
        ...(entry.options && { options: entry.options }),
        reason: entry.reason,
        triggeredBy: ['tsgolint'],
      })
    }

    const testRunners = (['vitest', 'jest'] as const).filter((signal) => hasSignal(stack, signal))

    if (typeAware.length > 0 && testRunners.length > 0) {
      for (const rule of TEST_FILE_EXEMPTIONS) {
        recommendations.push({
          kind: 'rule',
          target: rule,
          severity: 'off',
          files: TEST_FILES,
          reason: 'Mocks are `any` by construction, so in tests this reports every use of one.',
          triggeredBy: [...testRunners, 'tsgolint'],
        })
      }
    }
  }

  for (const { plugin, reason, rules, triggeredBy } of auditPlugins) {
    recommendations.push({
      kind: 'js-plugin',
      target: plugin,
      specifier: auditPluginSpecifier(plugin),
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

  return recommendations
}

/**
 * Capabilities the project could adopt but has not installed the tooling for.
 *
 * Reported instead of configured: writing type-aware config without the engine would
 * produce a config that fails at run time. Only capabilities this request would actually
 * use are reported - an install that changes nothing at the requested level is not a
 * prerequisite of anything.
 */
export function findPrerequisites(
  stack: ProjectStack,
  request: AuditRequest = DEFAULT_REQUEST,
  { format = true }: { format?: boolean } = {},
): Prerequisite[] {
  const prerequisites: Prerequisite[] = []
  const resolved = resolveRequest(request)

  if (hasSignal(stack, 'tsconfig') && !hasSignal(stack, 'tsgolint')) {
    const reachable = TYPE_AWARE_RULES.filter((entry) => isWanted(resolved, entry))

    if (reachable.length > 0) {
      prerequisites.push({
        capability: 'Type-aware linting',
        reason: `${reachable.length} type-aware rules at the ${resolved.level} level (including no-floating-promises) need type information, which Oxlint gets from the tsgolint engine.`,
        install: installCommand(stack.packageManager, ['oxlint-tsgolint']),
      })
    }
  }

  if (!hasSignal(stack, 'audit-plugins')) {
    const applicable = selectAuditPlugins(stack, resolved).map(({ plugin }) => plugin)

    if (applicable.length > 0) {
      prerequisites.push({
        capability: `Stack-specific audit rules (${applicable.join(', ')})`,
        // One install is enough: the package declares `@oxlint/plugins` as a dependency, so
        // the runtime every plugin imports arrives with it.
        reason: `This project's dependencies match ${applicable.length} of the audit plugins, which catch deprecated APIs and migration residue that still type-checks and still runs.`,
        install: installCommand(stack.packageManager, [AUDIT_PLUGINS_PACKAGE]),
      })
    }
  }

  if (format) {
    for (const [framework, runtime] of [
      ['svelte', 'svelte'],
      ['astro', '@astrojs/compiler-rs'],
    ] as const) {
      if (
        stack.sourceExtensions.includes(`.${framework}`) &&
        !hasFrameworkFormatter(stack, framework)
      ) {
        prerequisites.push({
          capability: `Formatting .${framework} files`,
          reason: `oxfmt formats .${framework} files only with ${runtime} installed, which it loads at run time and does not bundle. Until then they are left unformatted.`,
          install: installCommand(stack.packageManager, [runtime]),
        })
      }
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
  return [
    ...TARGETED_RULES.map(({ rule }) => rule),
    ...TYPE_AWARE_RULES.map(({ rule }) => rule),
    ...TEST_FILE_EXEMPTIONS,
    ...Object.keys(TYPE_AWARE_TWINS),
  ]
}

/** Every plugin this recommender can enable. */
export function getRecommendablePlugins(): OxlintBuiltinPlugin[] {
  return PLUGIN_RULES.map(({ plugin }) => plugin)
}

/**
 * Every js-plugin rule this recommender can emit, with its owning plugin.
 *
 * Deliberately separate from {@link getRecommendableRuleNames}: these rules come from
 * `@entro314labs/oxlint-audit-plugins`, not from Oxlint, so they are absent from the built-in inventory
 * and are checked against the plugin package instead.
 */
export function getAuditPluginRules(): Array<{ plugin: string; rules: string[] }> {
  return AUDIT_PLUGINS.map(({ plugin, rules }) => ({
    plugin,
    rules: rules.map(({ rule }) => rule),
  }))
}
