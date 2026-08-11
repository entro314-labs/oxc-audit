# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-08-11

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
