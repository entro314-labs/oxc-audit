# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

[Unreleased]: https://github.com/entro314-labs/oxc-audit/compare/v1.3.3...HEAD
[1.3.3]: https://github.com/entro314-labs/oxc-audit/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/entro314-labs/oxc-audit/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/entro314-labs/oxc-audit/compare/v1.0.0...v1.3.1
[1.0.0]: https://github.com/entro314-labs/oxc-audit/releases/tag/v1.0.0
