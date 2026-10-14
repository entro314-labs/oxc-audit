# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- The config now declares `env.browser` for code that renders in a browser (React DOM, Next.js, Vue, Svelte, Astro, Vite) and `env.node` for code that runs on Node. Without them `no-implied-eval` - recommended at every level for security - never fired on a bare `setTimeout("...")`, and `no-global-assign` did not protect `window` or `process`. An explicit `false` is left alone.
- Recommended rules now carry options that remove findings measured as noise across real projects, written only when the config does not already name the rule:
  - `typescript/no-misused-promises` exempts JSX attributes, so `onClick={async () => ...}` is no longer reported.
  - `no-unused-vars` honours the `_` prefix for arguments, variables, caught errors and array-destructuring slots (`[_, value]`), and removes unused imports under `--fix`.
  - `vitest/valid-title` and `jest/valid-title` accept a function or class as a suite name.
  - `import/no-unassigned-import` allows stylesheets and modules imported only for their effect, such as `server-only` and `dotenv/config`.
- With type-aware rules on and Vitest or Jest present, the config adds an override that turns the `typescript/no-unsafe-*` rules off in test files (`*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `test/`). Mocks are `any` by construction, and on the projects measured, test files produced over 90% of these rules' findings. Source files keep them. The override is not added when the project already set one of those rules itself.
- Generated JavaScript found in the scan - minified (any line over 1,000 characters) or carrying a bundler runtime (`webpackChunk*`, Turbopack's) - is added to `ignorePatterns` in both the Oxlint and the oxfmt config. Every `.min.js` becomes one `**/*.min.js` glob, and any other generated file is named exactly. On the measured projects a single vendored worker in `public/` produced 45,000 of 46,000 findings, and a directory of committed webpack chunks 36,000 of 37,000; `oxfmt --write` would have rewritten both.
- Three rules that Oxlint's categories enable, and that produced almost nothing but idioms on the projects measured, are written as `off` where the project has not set them: `unicorn/consistent-function-scoping`, `no-underscore-dangle`, and `vitest/require-mock-type-parameters`. The last one is filed under `correctness`, so before this it ran even at `--basic`.
- When a type-aware rule is recommended, its syntax-only twin is written `off` where the project has not set it. Before this, both reported the same line: `no-implied-eval`, `no-throw-literal`, `prefer-promise-reject-errors`, `require-await`, `unicorn/prefer-array-find` and `unicorn/prefer-string-starts-ends-with` were each doubled by their `typescript/*` counterparts. If `typeAware` is later turned off, the `off` stays until it is deleted.
- `.svelte` and `.astro` files are formatted when the compiler oxfmt loads for them is installed (`svelte`, `@astrojs/compiler-rs`): the formatter config turns on `svelte` / `astro` for a project with no previous formatter, or one whose Prettier used `prettier-plugin-svelte` / `prettier-plugin-astro`. Without the compiler the option is never written, since every format run would fail, and the missing package is reported as a prerequisite with its install command.
- An `oxlint`, `oxfmt` or `oxlint-tsgolint` declared at a range below the release the rules were checked against (oxlint 1.88, oxfmt 0.73, tsgolint 7.0.2004) is reported with an upgrade command. Oxlint refuses to load a config that names a rule it does not have, so an older release could fail to lint at all. Ranges that are not plain semver (`catalog:`, `workspace:`, dist-tags) are not judged.
- `--ts-config` creates `oxlint.config.ts` (`export default defineConfig({...})`) instead of `.oxlintrc.json` when the project has no Oxlint config. An existing `oxlint.config.ts` or `.mts` is now audited and updated in place, where previously any module config blocked the run. A module config that does more than export a plain object (other imports, `extends`, computed values) is reported but not rewritten.

### Fixed

- A project with no `packageManager` field was always told to run `pnpm add -D`, even with a `package-lock.json`, `yarn.lock` or `bun.lock` beside its manifest. The lockfile now decides, and the pnpm default applies only when there is none.
- A `pnpm-workspace.yaml` holding only settings (`minimumReleaseAge`, `allowBuilds`), which pnpm 10+ uses in single-package projects, made the project count as a workspace root and printed the "frameworks used in individual packages will be missed" warning. Only a file with a `packages` list counts now.
- An existing root-anchored `ignorePatterns` entry such as `"/dist"` was reported as an absolute path and blocked `--write`. Oxlint reads it gitignore-style, anchored to the config directory, so it is now accepted; a leading `/` in `overrides` globs, where it matches nothing, is still reported.
- A Prettier `endOfLine: "auto"` or Biome `lineEnding: "auto"` was copied into `.oxfmtrc.jsonc`, which oxfmt refuses to load, so every `format` and `format:check` run failed. It is left behind and reported.
- A project formatted with Prettier's or Biome's defaults was reformatted wholesale on the first oxfmt run, because oxfmt wraps at 100 columns where both wrap at 80, and Biome indents with tabs. Those defaults are now pinned when the source config leaves them unset and `.editorconfig` sets no `max_line_length`.

### Changed

- Prettier settings are also read from the `prettier` key of `package.json` and from a YAML `.prettierrc`, `.prettierrc.yaml` or `.prettierrc.yml`. `prettier-plugin-tailwindcss` and its `tailwind*` options become oxfmt's `sortTailwindcss`, and `experimentalOperatorPosition` is carried. Settings that cannot be carried, and a `.prettierrc.toml`, are reported instead of dropped silently.
- The type-aware rules no longer name `typescript/prefer-optional-chain` or `typescript/no-unnecessary-condition`. Both are in Oxlint's unstable `nursery` category, which this tool otherwise never enables, and naming a rule runs it whatever its category. A test now checks that no recommended rule is in `nursery`.
- `typescript/non-nullable-type-assertion-style` is no longer recommended at `--strict`. It rewrites `x as T` to `x!`, which `typescript/no-non-null-assertion` in the same config then reports.
- `typescript/strict-void-return` is no longer named at `recommended`, where it reported `promisify(execFile)` and every `onClick` handler that returns a value. Oxlint's `pedantic` category still enables it from `--strict`.
- Six type-aware rules in Oxlint's `suspicious` category (`no-unnecessary-boolean-literal-compare`, `no-unnecessary-type-arguments`, `no-unnecessary-type-assertion`, `no-unnecessary-type-conversion`, `no-unnecessary-template-expression`, `no-unsafe-type-assertion`) are listed at `recommended`, where the category already ran them, instead of `--strict`.
- Every rule is now listed at the level where Oxlint's categories actually start running it, and a conformance test holds every row to that. Behaviour is unchanged; the labels were wrong. The 17 `jsx-a11y` rules are in `correctness` and always ran wherever JSX is detected, not only at `--paranoid` or with `--accessibility`. `strict-boolean-expressions` and `prefer-readonly-parameter-types` arrive with `pedantic` at `--strict`, and `consistent-return` and `no-unnecessary-type-parameters` with `suspicious` at `recommended`, once type-aware is on. With Oxlint's current categories `--paranoid` adds nothing over `--strict`, and `--help` and the README now say so.
- Built and tested against oxlint 1.88, oxlint-tsgolint 7.0.2004 and oxfmt 0.73. The rule inventories under `docs/` now include `typescript/no-generated-empty-object-type` and oxfmt's `associations`, `astro` and `experimentalOperatorPosition` options.
- `@entro314labs/oxlint-audit-plugins` depends on `@oxlint/plugins` 1.88 and requires Node.js 24.21 or later.

## [1.5.0] - 2026-09-08

### Added

- A React 17+ or Next.js project's `recommended` config now writes `react/react-in-jsx-scope` as `off`, so component files are no longer reported for a `React` binding the automatic JSX runtime never uses. It only fills a gap: any value the project set for the rule, including a re-enable, is left alone. A new `react-jsx-runtime` signal records the evidence, and `--next` asserts it. ([cebfeec](https://github.com/entro314-labs/oxc-audit/commit/cebfeec))
### Changed

- The audit plugins are only ever used as the `@entro314labs/oxlint-audit-plugins` dependency. The install skill installs the package and either runs `oxc-audit --write` or registers the plugins by package subpath, instead of copying the TypeScript sources into `tools/oxlint/audit-plugins`. The CLI no longer recognises such a copy, the `oxlint-plugins` signal is gone, and the prerequisite always names the package. ([a393031](https://github.com/entro314-labs/oxc-audit/commit/a393031), [68ac56d](https://github.com/entro314-labs/oxc-audit/commit/68ac56d))
- `compareVersions` and `minimumVersionOf` moved to their own module; both remain exported from the package root. ([cebfeec](https://github.com/entro314-labs/oxc-audit/commit/cebfeec))
### Fixed

- The shipped `oxlintrc.audit.json` preset pointed at `./src/<plugin>/index.ts` files the published package does not contain, so every `oxlint -c node_modules/@entro314labs/oxlint-audit-plugins/oxlintrc.audit.json` run failed to start. The preset now names the built `dist/` files, and the fixture check reads the run's diagnostics so a preset that fails to load can no longer pass. ([0f86840](https://github.com/entro314-labs/oxc-audit/commit/0f86840), [33572bc](https://github.com/entro314-labs/oxc-audit/commit/33572bc))
- Five type-aware rules in Oxlint's `correctness` category were written at `warn` from `--strict`, overriding the `error` the category already gave them. They now sit at `recommended`/`error`, and every level is checked against Oxlint's rule listing so no recommendation can drop below its category's severity. ([2524e0f](https://github.com/entro314-labs/oxc-audit/commit/2524e0f))
- A commented `.oxfmtrc.jsonc` blocked the formatter write only after the linter config and `package.json` scripts had been written, leaving the run half-applied with exit code 1. Both halves are planned before either is written, and one blocker stops all three. ([bdf2a0c](https://github.com/entro314-labs/oxc-audit/commit/bdf2a0c))
- Biome's `arrowParentheses: "asNeeded"` and `quoteProperties: "asNeeded"` were carried into the oxfmt config unchanged, which oxfmt rejects. They are translated to `avoid` and `as-needed`; values with no oxfmt counterpart are left behind. ([8bb7de3](https://github.com/entro314-labs/oxc-audit/commit/8bb7de3))
- A flow-style `packages: ["apps/*", "!apps/native"]` in `pnpm-workspace.yaml` was not read, so `--recurse` fell back to plain discovery and wrote config into the excluded package. The file is now parsed as YAML. ([6bf6c3e](https://github.com/entro314-labs/oxc-audit/commit/6bf6c3e))
- `--dir` on a directory without its own `package.json` added the `lint` and `format` scripts to the closest parent manifest. Scripts are now written only to the audited directory's manifest, while dependency advice still comes from the closest manifest so the install command is not dropped. ([d6e7e0b](https://github.com/entro314-labs/oxc-audit/commit/d6e7e0b), [a3f50b4](https://github.com/entro314-labs/oxc-audit/commit/a3f50b4))
- `@oxlint/plugins` was reported missing whenever custom plugins were configured, even when `@entro314labs/oxlint-audit-plugins`, which depends on it, was installed. ([d6e7e0b](https://github.com/entro314-labs/oxc-audit/commit/d6e7e0b))
- Prerequisites ignored the request: `--basic` asked for `oxlint-tsgolint` it would never configure, and install commands always said `pnpm` regardless of the manifest's `packageManager`. Both now follow the level and the package manager. ([d6e7e0b](https://github.com/entro314-labs/oxc-audit/commit/d6e7e0b))
- The `tsconfig.json` checks recognised Next.js from `next.config.ts` alone; every spelling the stack detector accepts, and the `--next` flag, now count. ([d6e7e0b](https://github.com/entro314-labs/oxc-audit/commit/d6e7e0b))
- `--security` recommended both `react/no-danger` and `web-security/require-sanitized-html`, which the plugin package documents as one-or-the-other. The built-in rule stands down when the plugin is recommended. ([d6e7e0b](https://github.com/entro314-labs/oxc-audit/commit/d6e7e0b))
- `--help` claimed `--paranoid` enables `restriction` and `style`; it never has. The README usage block no longer lists the removed `--format` flag, and the plugin README's `jsPlugins` example points at paths the package actually ships. ([e38a52b](https://github.com/entro314-labs/oxc-audit/commit/e38a52b))

## [1.4.0] - 2026-09-08

`@entro314labs/oxlint-audit-plugins` 1.3.2 ships alongside: its preset fix below is the
only change to that package.

### Changed

- A React 17+ or Next.js project's `recommended` config no longer reports every component
  file under `react/react-in-jsx-scope`. The rule demands a `React` binding the automatic JSX
  runtime never uses, and Oxlint has no runtime setting that quietens it, so it is now written
  as `off` on that evidence - the one `off` this tool writes. It fills a gap only: a value the
  project set for the rule, a re-enable included, is left alone. The new `react-jsx-runtime`
  signal records the range or Next.js evidence behind it, and `--next` asserts it.
- The CLI no longer recognises a copy of the plugin sources under `tools/oxlint/audit-plugins`,
  and the `oxlint-plugins` signal that gated it is gone. The plugins are only ever a dependency,
  and the install skill installs the package instead of copying its sources.
- `compareVersions` and `minimumVersionOf` moved to their own module; both are still exported
  from the package root.

### Fixed

- The shipped `oxlintrc.audit.json` preset named `./src/<plugin>/index.ts`, which the
  published package does not contain, so every documented `oxlint -c node_modules/.../oxlintrc.audit.json`
  run failed to start. It now names the built `dist/` files the package exports, and the
  fixture check reads the run's diagnostics instead of its exit code, so a preset that fails
  to load can no longer pass as one that found something.
- Five type-aware rules that sit in Oxlint's `correctness` category were recommended at
  `warn` from `--strict`. The category is on at `error` from `--basic`, so naming them at
  `warn` weakened a check that was already running. They now sit at `recommended`/`error`,
  and every level is checked against Oxlint's own rule listing so no recommendation can fall
  below the severity its category already gives it.
- A commented `.oxfmtrc.jsonc` blocked the formatter write only after the linter config and
  the `package.json` scripts had been written, leaving the run half-applied with exit code 1.
  Both halves are now planned before either is written, and one blocker stops all three.
- Biome's `arrowParentheses: "asNeeded"` and `quoteProperties: "asNeeded"` were carried into
  the oxfmt config unchanged, which oxfmt rejects outright. They are translated to `avoid` and
  `as-needed`.
- A flow-style `packages: ["apps/*", "!apps/native"]` in `pnpm-workspace.yaml` was not read,
  so `--recurse` fell back to plain discovery and wrote config into the excluded package.
- `--dir` on a directory with no `package.json` added the `lint` and `format` scripts to the
  closest parent manifest, outside the audited directory. Only the audited directory's own
  manifest is touched.
- `@oxlint/plugins` was reported as missing whenever custom plugins were configured, even when
  `@entro314labs/oxlint-audit-plugins` - which depends on it - was installed.
- Prerequisites ignored the level: `--basic` asked for `oxlint-tsgolint` it would never
  configure, and install commands always said `pnpm` regardless of the manifest's
  `packageManager`.
- The `tsconfig.json` checks recognised Next.js from `next.config.ts` alone; every spelling the
  stack detector accepts, and a `--next` flag, now count.
- `--security` recommended both `react/no-danger` and `web-security/require-sanitized-html`,
  which the plugin package documents as one-or-the-other. The built-in rule stands down when
  the plugin is recommended.
- `--help` claimed `--paranoid` enables `restriction` and `style`; it never has.

## [1.3.3] - 2026-09-03

### Fixed
- Both packages are now published under the `@entro314labs` npm scope, so installs resolve the correct scoped package names ([1d4fe6b](https://github.com/entro314-labs/oxc-audit/commit/1d4fe6b))

## [1.3.2] - 2026-09-03

### Changed

- Both packages are now published under the `@entro314labs` npm scope: `oxc-audit` is
  `@entro314labs/oxc-audit` and `oxlint-audit-plugins` is `@entro314labs/oxlint-audit-plugins`.
  A generated `.oxlintrc.json` names the scoped specifier — `@entro314labs/oxlint-audit-plugins/data-layer`
  — and the reported install command matches, so a project on the unscoped package keeps working
  until it reinstalls under the new name, at which point the custom plugins are recommended again.
  The installed binary is still `oxc-audit`.

### Fixed

- The package build no longer fails on TypeScript 7.1. The declaration build now names the tsgo generator explicitly and resolves the compiler binary through TypeScript's own `getExePath`, instead of relying on a `7.0` version prefix and an undeclared `@typescript/native-preview` dependency. Type declarations ship again. ([b922a84](https://github.com/entro314-labs/oxc-audit/commit/b922a84))

## [1.3.1] - 2026-09-03

### Changed

- Oxlint and `@oxlint/plugins` moved to `^1.81.0`.
- `docs/oxlint-rules.tsv` refreshed against Oxlint 1.81. Oxlint 1.79 dropped
  `react/react-compiler` and added the 22 React Compiler rules that replaced it, so a config
  generated for a React project now carries 12 of them through `correctness` at every level and
  four more through `suspicious` at `recommended`, without the recommender naming any of them.
  `jsdoc/no-blank-blocks` and `one-var` were added too. The two `suspicious` rules that check
  dependency arrays overlap `react/exhaustive-deps`, which `correctness` already enables, so from
  the `recommended` level a missing dependency reports twice. This tool never writes an `off`, so
  silencing one side is the project's call.

## [1.0.0] - 2026-08-11

Initial release.

### Added

- Deterministic stack detection from declared dependencies (`dependencies`,
  `devDependencies`, `peerDependencies`), config files, manifest fields, and the real
  source tree. Every signal records the evidence that established it; nothing is inferred.
- A recommendation table mapping detected signals to Oxlint plugins, baseline categories,
  and a short list of targeted rules. Each recommendation carries its triggering signals
  and a reason.
- Additive-only config merging with three invariants: nothing is removed, nothing is
  weakened, and an explicit `off` is treated as a decision and never overwritten. Enabling
  a plugin carries Oxlint's base set along, because setting `plugins` overwrites it.
- `oxc-audit` CLI with report-only default, `--write`, `--json`, `--dir`, `--config`,
  `--max-files`, and `--no-backup`.
- The CLI decides it is the process entrypoint by real path, so `npx oxc-audit` and
  `node_modules/.bin/oxc-audit` run the audit. Package managers install a bin as a symlink
  and Node leaves `process.argv[1]` pointing at the link while resolving `import.meta.url`
  to its target, so comparing the two raw paths would exit 0 having produced nothing.
- Library API: `audit`, `detectStack`, `recommendForStack`, `mergeRecommendations`.
- Atomic writes, automatic `.backup` of the previous config, `restoreConfigBackup()`, and
  a project-scoped lock with stale-lock reclamation.
- A write against a config containing comments is blocked rather than silently dropping
  them; reporting is unaffected.
- Merged configs are validated against Oxlint's glob constraints before being written.
- Conformance tests that run the real `oxlint` binary to check generated configs load,
  that claimed plugins are actually enabled, and that no previously-active plugin is
  disabled by a write.
- Inventory conformance: recommended rule and plugin names are checked against
  `docs/oxlint-rules.tsv`.
- `publint` and `arethetypeswrong` (`esm-only`) run on every build.
- Svelte and Astro detection. Oxlint lints their script blocks with universal rules but
  ships no dedicated plugin, so the gap is reported as a prerequisite rather than silently
  producing nothing.
- Type-aware rule support, gated on the `oxlint-tsgolint` dependency. Without the engine
  `oxlint --type-aware` fails outright, so the capability is reported as a prerequisite
  instead of being written into a config the project could not run. Recommended type-aware
  rules are validated against the `status` column of `docs/tsgolint-rules.tsv`.
- Workspace detection covers `pnpm-workspace.yaml`, `lerna.json`, and `nx.json` alongside
  `package.json#workspaces`, and a workspace root warns that dependency signals come from
  the root manifest only.
- Conformance fixtures exercising `.vue`, `.svelte`, and `.astro` against the real Oxlint
  binary, asserting the files are actually parsed rather than skipped.
- Three hand-picked Vue rules that are off by default and name a concrete failure:
  `no-multiple-slot-args`, `require-typed-ref`, and `require-prop-types`. Oxlint's
  `correctness` category already covers 33 of the 46 Vue rules, so the rest are left alone.
- `--recurse` audits a workspace root and every package beneath it, each against its own
  nearest config. Packages are discovered by walking for `package.json`, which covers every
  workspace convention without parsing four different declaration formats.
- `auditWorkspace()`, `findWorkspacePackages()` and `discoverWorkspace()` are exported for
  library use, and `--max-depth` bounds the package search.
- Workspace declarations filter discovery, including negated globs. A package a repo
  deliberately excludes (`'!apps/native'`) is never audited, and the skip is reported
  rather than silent. `pnpm-workspace.yaml`, `package.json` workspaces (both array and
  object forms), and `lerna.json` are read; with no declaration every package found on
  disk is audited as before.

[Unreleased]: https://github.com/entro314-labs/oxc-audit/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/entro314-labs/oxc-audit/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/entro314-labs/oxc-audit/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/entro314-labs/oxc-audit/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/entro314-labs/oxc-audit/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/entro314-labs/oxc-audit/compare/v1.0.0...v1.3.1
[1.0.0]: https://github.com/entro314-labs/oxc-audit/releases/tag/v1.0.0
