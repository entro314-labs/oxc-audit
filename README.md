# oxc-audit

Read a project's stack off disk and configure the Oxc toolchain around it.

`oxc-audit` scans a project - declared dependencies, config files, the real source tree -
and works out what actually applies: which of Oxlint's fifteen plugins, which of tsgolint's
type-aware rules, which custom plugins, and what the formatter should be set to. It reports
what to add, or adds it for you. Run it on a project with no Oxc config to get a sensible
starting point, or on one that already has a config to see what the stack has outgrown.

```bash
npx oxc-audit                      # report only
npx oxc-audit --write              # apply the recommendations
npx oxc-audit --strict --security  # ask for more
npx oxc-audit --strict --write     # apply a stricter set
```

Four tools, one pass:

| Tool                   | What it gets                                                    | Written to       |
| ---------------------- | --------------------------------------------------------------- | ---------------- |
| `oxlint`               | Plugins, categories and targeted rules for the detected stack   | `.oxlintrc.json` |
| `oxlint-tsgolint`      | Type-aware rules, scaled by level, when the engine is installed | `.oxlintrc.json` |
| `oxlint-audit-plugins` | Custom plugins for the frameworks and libraries in use          | `.oxlintrc.json` |
| `oxfmt`                | Formatter settings, carried over from Prettier or Biome         | `.oxfmtrc.jsonc` |

Nothing is written for a tool that is not installed. Where a capability is wanted but its
engine is missing, it is reported as a prerequisite rather than configured, because a config
naming a missing engine is one Oxlint refuses to start on. That covers `oxlint-tsgolint` for
the type-aware rules, and `oxlint-audit-plugins` for the custom ones.

`--write` also adds `lint`, `lint:fix`, `format` and `format:check` scripts to `package.json`
when they are absent, so there is something to run. An existing script of the same name is
left alone. Dependencies are reported with the right command for the project's own package
manager, never installed — the lockfile is the project's to change.

## The custom plugins

`oxlint-audit-plugins` on npm, built from [plugins/](plugins/). One install, and the runtime
every plugin imports arrives with it as a dependency:

```bash
pnpm add -D oxlint-audit-plugins
```

```jsonc
{
  "jsPlugins": ["oxlint-audit-plugins/data-layer"],
  "rules": { "data-layer/no-zod-trim-after-min-length": "error" }
}
```

Oxlint resolves that through the package's `exports` map, so the config keeps working when the
package reorganises its files and under package managers that do not hoist into a flat
`node_modules`.

The package ships compiled JavaScript rather than its TypeScript sources. Node refuses to
strip types from anything under `node_modules` — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
— so a package of `.ts` files cannot be loaded by any consumer, however new their Node is.

Worth knowing before you rely on these rules: Oxlint states that **js plugins are in alpha and
not subject to semver**, so the plugin API can change between minor releases.

## What it does

```
Stack
  esm, jsx, nextjs, react, react-dom, typescript, vitest
  312 files scanned

Recommended
  plugin react [react, nextjs]
      React is a dependency, so the react rules apply.
  plugin jsx-a11y [jsx]
      JSX is present, so the accessibility rules have something to check.
  rule react/jsx-no-target-blank: error [react, nextjs]
      `target="_blank"` without `rel="noreferrer"` exposes `window.opener`.

  Run with --write to apply these to /project/.oxlintrc.json
```

Every recommendation names the signals that triggered it and why it exists. Nothing is
recommended without evidence in the project.

## Levels

How much to ask for. Each level is a strict superset of the one below, and they map onto
Oxlint's own categories, so they mean here what they mean in a hand-written config.

| Level                       | Categories             | Type-aware rules                          | Findings on a clean codebase |
| --------------------------- | ---------------------- | ----------------------------------------- | ---------------------------- |
| `--basic`                   | `correctness`          | none                                      | 0                            |
| `--recommended` _(default)_ | `+ suspicious`         | the ~27 that find unsound code            | ~38                          |
| `--strict`                  | `+ pedantic`, `+ perf` | `+ ~27` that reject a lot of working code | ~341                         |
| `--paranoid`                | same as strict         | `+ 5` whole-codebase policies             | ~350                         |

The last column was measured against this repository, which passes its own lint. `paranoid`
means depth of checking rather than breadth of opinion, which is why it adds no categories
over `strict`.

Three categories are never enabled, at any level:

- **`style` and `restriction` are taste, not defects.** On the same codebase they report
  roughly 1,200 and 400 findings - `no-ternary`, `no-null`, `no-magic-numbers` and the like.
  Turning them on wholesale is the unasked-for churn this tool exists not to create. A
  project that wants them can set them itself, and nothing here will overwrite that.
- **`nursery` is unstable upstream**, so a config carrying it would change meaning on an
  Oxlint patch and break determinism.

`--dom` is the maximal switch - `--paranoid` with every domain turned on at once. It changes
nothing about evidence: a rule with no signal behind it is still never recommended.

## Domains

Cross-cutting sets that ignore the ladder. `--security` on a `--basic` run still gets the
whole security set, and nothing else moves.

| Flag              | Covers                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `--security`      | The injection primitives, cookie and iframe rules, plus the `web-security` and `supabase` plugins |
| `--performance`   | Oxlint's `perf` category, `react-perf`, and the quadratic-loop and context-value rules            |
| `--accessibility` | 17 `jsx-a11y` rules that are off by default, at `error`                                           |

## Forcing a stack

`--react`, `--next`, `--vue`, `--svelte`, `--astro`, `--typescript`, `--node`, `--vitest`
and `--jest` assert a signal the project does not declare. A flag is a claim about the
project rather than a rule set: it joins the detected stack as `flag` evidence and then
travels the same path a detected signal would, so the report still explains every
recommendation. Anything reached only by a flag is marked:

```
Stack
  esm, typescript, vue (forced)
```

`--next` implies React, because a Next.js project is a React project and the rules gated on
`react` would otherwise be skipped.

## The formatter

A formatter config is part of the toolchain, so `.oxfmtrc.jsonc` is written beside the linter
config by default; `--no-format` skips it. Both follow the same additive rule: a key already
present is a decision and is never overwritten, so a second run is a no-op.

An existing Prettier or Biome config wins over every default - the codebase is already
formatted that way, and imposing different settings would rewrite every file on the first
run. Biome's spellings are translated (`indentStyle` → `useTabs`, `lineWidth` →
`printWidth`, `quoteStyle` → `singleQuote`). Keys with no oxfmt equivalent are left behind
rather than guessed at, and a `prettier.config.js` is reported rather than executed -
running a project's config file to find out how it formats is not something an audit should
do.

## Configuration findings

Oxlint only reads JavaScript and TypeScript. A large share of what goes wrong in a project
lives in files it cannot see at all - so those are checked here instead, and reported
separately from the Oxlint recommendations:

```
Configuration findings (not applied)
  error   turbo.json:pipeline - Turborepo 1.x `pipeline` key
      Turborepo 2 renamed `pipeline` to `tasks`. Run `npx @turbo/codemod migrate`.
  error   pnpm-workspace.yaml:onlyBuiltDependencies - Setting removed in pnpm 11
      `onlyBuiltDependencies` was consolidated in pnpm 11 and is no longer read.
  error   package.json:dependencies.next - Dependency below its security floor
      `next@^16.2.9` can resolve to 16.2.9, below the 16.2.11 floor that fixes
      the July 2026 monthly set, CVE-2026-64641..64649. Raise the range.
```

| File                  | Checked for                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turbo.json`          | The Turborepo 1.x `pipeline` key; build tasks with no `outputs`; `cache: false`                                                                                                                          |
| `pnpm-workspace.yaml` | Settings consolidated into `allowBuilds` in pnpm 11; `auditConfig.ignoreCves`; protective defaults turned off                                                                                            |
| `package.json`        | Dependencies below a published security floor; `engines.node` below what a dependency requires                                                                                                           |
| `tsconfig.json`       | `baseUrl` and `moduleResolution: "node"` under Next.js 16.3, which stopped suppressing their warnings; `strict` off; no `include`/`files`, which Oxlint names as the usual cause of slow type-aware runs |

**These are never applied.** They sit outside the configs this tool writes, and their
fixes are codemods and version bumps rather than key edits. A version range the checker
cannot reduce to a minimum is reported as `info` rather than assumed safe, and a malformed
config file is skipped with a warning rather than aborting the audit.

## Two properties it guarantees

**Deterministic.** Every signal is a fact read off disk: a declared dependency, a config
file that exists, a file extension actually present in the tree. There are no heuristics,
no scoring, and no network calls. The same project always produces the same output, which
is what makes it safe in CI.

**Additive.** A run can only ever add checks. Three invariants hold for any input:

1. **Nothing is removed.** No rule, plugin, category, override, or unrecognised field is
   dropped - including fields this tool does not understand.
2. **Nothing is weakened.** A rule already at `error` stays at `error` when only `warn` is
   recommended. Rule options survive a severity change. Enabling a plugin carries Oxlint's
   base set along, because [setting `plugins` overwrites that base set][plugins-note] and
   doing so naively would disable `unicorn`, `typescript`, and `oxc`.
3. **An explicit `off` is a decision.** A rule you turned off stays off. It is reported so
   the opt-out stays visible, but never re-enabled.

Those invariants are asserted directly, over a matrix of existing configs, in
`src/config-merger.test.ts`.

[plugins-note]: https://oxc.rs/docs/guide/usage/linter/plugins.html

## What it detects

| Signal                | Established by                                                                |
| --------------------- | ----------------------------------------------------------------------------- |
| `typescript`          | `typescript` dependency, `tsconfig.json`, or `.ts`/`.tsx`/`.mts`/`.cts` files |
| `jsx`                 | `.jsx` or `.tsx` files                                                        |
| `react` / `react-dom` | the corresponding dependency                                                  |
| `nextjs`              | `next` dependency or `next.config.*`                                          |
| `vue`                 | `vue`/`nuxt` dependency, `vue.config.*`/`nuxt.config.*`, or `.vue` files      |
| `svelte`              | `svelte` dependency, `svelte.config.*`, or `.svelte` files                    |
| `astro`               | `astro` dependency, `astro.config.*`, or `.astro` files                       |
| `vitest` / `jest`     | the dependency or its config file                                             |
| `node`                | `@types/node`, `engines.node`, or a `bin` field                               |
| `esm`                 | `"type": "module"`                                                            |
| `monorepo`            | `workspaces`, `pnpm-workspace.yaml`, `lerna.json`, or `nx.json`               |
| `tsconfig`            | `tsconfig.json` (tracked separately - type-aware linting needs a real one)    |
| `tsgolint`            | `oxlint-tsgolint` dependency                                                  |
| `jsdoc`               | `jsdoc` or `typedoc` dependency                                               |

A further set of signals exists only to decide which custom plugins apply, and each is
established by its dependency alone: `zod`, `tanstack-query`, `zustand`, `react-hook-form`,
`drizzle`, `ai-sdk`, `stripe`, `supabase`, and `vite`. `audit-plugins` marks the plugin
package itself, as a dependency or as a copy under `tools/oxlint/audit-plugins`.

Dependencies are read from `dependencies`, `devDependencies`, and `peerDependencies`, so a
monorepo leaf package that inherits a framework is still detected.

Oxlint parses `.vue`, `.svelte`, and `.astro` and lints their script blocks with its
universal rules, but ships a dedicated plugin only for Vue. Svelte and Astro are still
detected, and the missing plugin is reported rather than silently producing nothing.

## Workspaces

Dependency signals come from one manifest, so auditing only a workspace root
under-reports: the frameworks live in the leaf packages. `--recurse` audits the root and
every package beneath it, each against its own nearest config - which is also how Oxlint
resolves configs, since a child config is used on its own rather than merged into the
parent's.

```bash
oxc-audit --recurse            # report on every package
oxc-audit --recurse --write    # give each package its own config
```

Packages are found by walking for `package.json`, skipping `node_modules` and build
output. When the repo declares its packages - `package.json` workspaces,
`pnpm-workspace.yaml`, or `lerna.json` - that declaration then filters the result,
**including its exclusions**:

```yaml
packages:
  - apps/*
  - '!apps/native'   # owns its own dependency graph and lockfile
  - packages/*
```

`apps/native` is skipped, and the skip is reported rather than silent. Honouring
exclusions matters: a package kept out of a workspace on purpose is one the repo has
deliberately set apart, and writing config into it would be exactly the unrequested change
this tool avoids everywhere else.

With no declaration, every package found on disk is audited.

Without `--recurse`, a workspace root warns that it is under-reporting rather than passing
silently.

## Type-aware rules

Oxlint's type-aware rules run on the tsgolint engine, shipped separately as
`oxlint-tsgolint`. Without it, `oxlint --type-aware` fails with _"Failed to find tsgolint
executable"_.

So type-aware rules are recommended **only when `oxlint-tsgolint` is already a
dependency**. Writing `options.typeAware` without the engine would produce a config the
project cannot run. When a `tsconfig.json` is present but the engine is not, the
capability is reported as a prerequisite instead:

```
Available with an extra install
  Type-aware linting
      59 type-aware rules (including no-floating-promises) need type information,
      which Oxlint gets from the tsgolint engine.
      pnpm add -D oxlint-tsgolint
```

All 59 rules tsgolint implements are placed on the level ladder, by how much working code
each rejects rather than by how useful it is. `--recommended` carries the ones that find
genuinely unsound code - the `no-unsafe-*` family, `no-floating-promises`, `only-throw-error`,
`switch-exhaustiveness-check`. `--strict` adds the ones that are right but reject a great deal
of working code. `--paranoid` adds the whole-codebase policies, `strict-boolean-expressions`
and `prefer-readonly-parameter-types` among them. `--basic` carries none, and does not write
`options.typeAware` at all, since the option exists only to load an engine that would have
nothing to run.

Recommended type-aware rules are checked against `docs/tsgolint-rules.tsv` **including its
`status` column**, so a rule tsgolint has not implemented yet can never be recommended -
that would configure something which silently never runs. The reverse is checked too, against
`docs/oxlint-vs-tsgolint.tsv`: a rule that needs type information can never be recommended
outside the tsgolint gate, where Oxlint would accept it and it would never fire.

## Usage

```
Usage: oxc-audit [options]

Deterministically audit a project's stack and configure the Oxc toolchain around
it - oxlint, tsgolint and oxfmt

Options:
  -V, --version        output the version number
  -d, --dir <path>     Project directory to audit (default: current directory)
  -c, --config <path>  Path to the Oxlint config (default: .oxlintrc.json)
  -w, --write          Apply the recommendations. Without this the audit only
                       reports.
  --no-backup          Skip writing a .backup copy before applying changes
  --max-files <count>  Maximum source files to scan before truncating
  -r, --recurse        Also audit every package found beneath the directory
  --max-depth <depth>  Directory depth to search for workspace packages
  --format             Also write an oxfmt formatter config beside the linter
                       config
  --json               Print the audit report as JSON to stdout
  -v, --verbose        Show detailed progress information
  --basic              Correctness only - the smallest config that still catches
                       real bugs
  --recommended        Correctness and suspicious, plus the targeted rules
                       (default)
  --strict             Also pedantic and perf, and the type-aware rules that
                       reject working code
  --paranoid           Also restriction and style, and the whole-codebase
                       policies
  --security           Enable the security rule set regardless of the level
  --performance        Enable the performance rule set regardless of the level
  --accessibility      Enable the accessibility rule set regardless of the level
  --typescript         Audit as if typescript and tsconfig were present
  --react              Audit as if react, react-dom and jsx were present
  --next               Audit as if nextjs, react, react-dom and jsx were present
  --vue                Audit as if vue were present
  --svelte             Audit as if svelte were present
  --astro              Audit as if astro were present
  --node               Audit as if node were present
  --vitest             Audit as if vitest were present
  --jest               Audit as if jest were present
  --dom                Every rule the detected stack could justify: the paranoid
                       level with every domain on
  -h, --help           display help for command
```

Exit code is `0` when the audit succeeds and `1` when it hits an error or a blocker.

### Library

```ts
import { audit, detectStack, recommendForStack, mergeRecommendations } from 'oxc-audit'

const report = await audit({
  projectDir: process.cwd(),
  level: 'strict',
  domains: ['security'],
  forcedSignals: ['react'],
  format: true,
})

for (const recommendation of report.recommendations) {
  console.log(recommendation.target, '<-', recommendation.triggeredBy.join(', '))
}
```

`detectStack`, `recommendForStack`, and `mergeRecommendations` are exported separately so
you can substitute your own recommendation table while keeping the detection and the
merge invariants. `recommendForStack` takes the same request the CLI builds, so a level
and a set of domains produce the same result either way.

## Safety

- **Writes are atomic.** The config is written to a temporary file and renamed, so a
  crash mid-write cannot leave a truncated config.
- **The previous config is backed up** to `.oxlintrc.json.backup` before any change.
  `restoreConfigBackup()` puts it back.
- **Concurrent runs are serialized** by a project-scoped lock, which reclaims itself if a
  previous run was killed.
- **Comments block a write.** Oxlint accepts JSONC, but rewriting the file would drop the
  comments. Rather than lose them silently, `--write` refuses and says so. Reporting still
  works normally.
- **The merged config is validated** against Oxlint's glob constraints before it is
  written, not after.

## What it is not

Not a security scanner. Oxlint has no security plugin; the handful of security-relevant
rules here (`no-eval`, `no-new-func`, `no-script-url`, `react/no-danger`,
`react/jsx-no-target-blank`) catch specific well-understood mistakes. They are worth
having, and they are not a substitute for a SAST tool or dependency auditing.

Rule selection stays proportional to what a plugin already covers. Oxlint's `correctness`
category alone carries 33 of the 46 Vue rules, so only three Vue rules are hand-picked -
the ones that are off by default _and_ name a concrete failure. The other ten
off-by-default Vue rules are casing and declaration-style choices, which are yours to make.

It also does not enable `pedantic`, `style`, `restriction`, or `nursery` wholesale. Those
are matters of taste or are unstable, and turning them on for someone is exactly the kind
of unrequested churn this tool exists to avoid.

## Development

```bash
pnpm install
pnpm check    # format, lint, typecheck, test
pnpm build    # bundle, plus publint and arethetypeswrong gates
```

The test suite includes a conformance layer that runs the real `oxlint` binary against
generated configs. It checks that configs load, that the plugins claimed are actually
enabled, that no previously-active plugin gets disabled, that `.vue`/`.svelte`/`.astro`
files are genuinely linted rather than silently skipped, and that type-aware rules
actually fire through the tsgolint engine.

Recommended rule and plugin names are checked against the tracked inventories in `docs/`,
so a rename upstream fails the suite rather than shipping a config referencing a rule that
no longer exists.

| Inventory                | Covers                                                           | What it is checked for                                                                                 |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `oxlint-rules.tsv`       | Every rule Oxlint ships, with its plugin                         | No recommended rule or plugin is invented                                                              |
| `tsgolint-rules.tsv`     | Every tsgolint rule, with implementation status                  | No type-aware rule is recommended before tsgolint implements it                                        |
| `oxlint-vs-tsgolint.tsv` | Every `typescript/*` rule, and whether it needs type information | No type-aware rule is recommended outside the tsgolint gate, where it would be accepted and never fire |
| `oxfmt-rules.tsv`        | The oxfmt configuration surface                                  | Reference only - this tool does not write formatter config                                             |

All four are generated from the schemas the installed toolchain ships, never edited by hand.
`pnpm docs:sync` rewrites them after a toolchain upgrade, and `pnpm docs:check` runs inside
`pnpm check`, so an inventory that no longer matches the installed Oxlint fails the build.

### Releasing

Bump the version in `package.json`, add the matching `## [x.y.z]` section to
`CHANGELOG.md`, then:

```bash
pnpm release --dry-run   # run every check and pack the tarball, changing nothing
pnpm release             # publish to npm, tag the version, open the GitHub release
```

The release notes are the CHANGELOG section for that exact version. npm credentials,
`gh` auth, an `origin` remote, and an unused tag are all verified before anything is
published.

## License

MIT
