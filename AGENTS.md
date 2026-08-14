# AGENTS.md

## What this repository is

Two things that ship separately and are installed separately.

**`oxc-audit`** - the CLI, in [src/](src/) and [bin/](bin/). It reads a project's stack off disk
and configures the Oxc toolchain around it. Published to npm.

**`oxlint-plugin-audit`** - seven custom Oxlint plugins, in [plugins/](plugins/). Loaded through
`jsPlugins`. Currently `private`, distributed by copying via its install skill.

The CLI covers the whole Oxc toolchain, not just the linter: `oxlint` rules, the type-aware
`tsgolint` rules, the custom plugins, and - behind `--format` - the `oxfmt` config. Each has a
tracked inventory under `docs/` that the recommender is checked against.

The CLI knows about the plugins: when it detects both a covered stack and the plugin package, it
recommends the matching `jsPlugins` entries and rules. When the stack is there but the package is
not, it reports a prerequisite instead.

## Running checks

The two halves have separate `node_modules` and separate commands. Running one does not check the
other.

```bash
pnpm check                                    # CLI: format, lint, typecheck, vitest
cd plugins && pnpm install --ignore-workspace # first time only
cd plugins && pnpm check                      # plugins: lint, typecheck, rule tests, fixtures, skill assets
```

`plugins/` is not a pnpm workspace member. It has its own lockfile and is installed with
`--ignore-workspace`.

## Conventions

**Two formatting styles, deliberately.** The CLI uses 2-space indentation, no semicolons, single
quotes. `plugins/` uses tabs, semicolons, double quotes - the Oxlint plugin ecosystem's style.
Root `.oxfmtrc.jsonc` ignores `plugins` so `pnpm format` cannot reflow it. Both trees are linted
by the root `.oxlintrc.json`, which they both satisfy.

**Comments and docs state what the code is and does.** Not what it used to be, where it came
from, or what was considered and rejected. A comment explaining a non-obvious constraint belongs
next to the code it constrains.

## Invariants worth knowing before changing anything

**The recommender never names a rule that does not exist.** [src/rule-recommender.ts](src/rule-recommender.ts)
is checked against `docs/oxlint-rules.tsv`, `docs/tsgolint-rules.tsv`, and - for the js-plugin
rules - each plugin's own `index.ts`, by [src/rule-inventory.test.ts](src/rule-inventory.test.ts).
Renaming a rule in `plugins/` without updating the recommender fails the build. That is intended.

**The merger only ever adds.** [src/config-merger.ts](src/config-merger.ts) never removes a field,
never lowers a severity, and treats an explicit `"off"` as a decision to report rather than
overwrite. This is what makes the tool safe to run repeatedly against a config someone else
maintains. Any change here needs the invariant tests in `config-merger.test.ts` to still hold.

**The custom plugins supplement the built-in rules; they never replace them.** Whenever a stack
earns a js-plugin it must also earn Oxlint's built-in plugin for the same ground, and a rule is
never recommended without the plugin that provides it - a `react/*` rule in a config with no
`react` plugin is dead config. Both are asserted in `rule-recommender.test.ts`. The same applies
to `plugins/oxlintrc.audit.json`, which enables the built-in plugins beside the custom ones.

**Never configure tooling that is not installed.** Type-aware rules are gated on `oxlint-tsgolint`
being present; `jsPlugins` entries are gated on the plugin package being present. Writing either
without its dependency produces a config Oxlint refuses to start on. When the capability is
wanted but unavailable, it becomes a `Prerequisite`, not a `Recommendation`.

**Levels are a ladder, and each rung is a superset of the one below.** `basic` ⊂
`recommended` ⊂ `strict` ⊂ `paranoid`, asserted directly in `rule-recommender.test.ts`.
Adding a rule at a lower level therefore adds it to every level above. `nursery` is never
enabled - its rules are unstable upstream and would break determinism.

**Flags assert signals; they do not bypass the engine.** `--react` adds a `flag` evidence
entry via `withForcedSignals` and then travels the same path a detected signal would, so
`triggeredBy` stays truthful and the report can mark what was forced. `--dom` is not a
separate mode: it resolves to `paranoid` with every domain on, so one code path decides
everything.

**Detection is evidence, not inference.** Every `StackSignal` in
[src/stack-detector.ts](src/stack-detector.ts) records the dependency, config file or extension
that established it. Nothing guesses, so the same project always produces the same result.

**A plugin rule offers a fix only when the rewrite is behaviour-preserving on its own.** Rules
that would change which inputs are accepted, or that need a decision, report without a fix. Each
rule's test asserts `meta.fixable` is unset where that applies. `plugins/README.md` records the
reasoning per rule.

**`plugins/fixtures/` is deliberately broken.** It is an end-to-end check that the plugins load
and fire under a real `oxlint` run - `pnpm test:fixtures` fails if the fixtures stop producing
findings. Do not "fix" it, and do not lint it with the root config (it is in `ignorePatterns`).

## Adding a rule to a plugin

1. Write it in `plugins/src/<plugin>/rules/`, against the typed `ESTree` API from
   `@oxlint/plugins`. Anchor on import bindings via `shared/imports.ts` rather than on bare
   identifier names, so a project-local `z` is not mistaken for Zod.
2. Write a `RuleTester` suite next to it covering the near-miss cases it must _not_ report. The
   valid cases matter more than the invalid ones.
3. Register it in the plugin's `index.ts` and in `oxlintrc.audit.json`.
4. Add a line to the plugin's table in `plugins/README.md`.
5. Add it to `AUDIT_PLUGINS` in `src/rule-recommender.ts` if the CLI should recommend it - rules
   that fire on most existing code should not be.
6. Run `pnpm check` in both trees.
