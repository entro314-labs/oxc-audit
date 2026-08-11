# oxc-audit

Read a project's stack off disk and recommend the Oxlint rules it is missing.

`oxc-audit` scans a project — declared dependencies, config files, the real source tree —
and works out which of Oxlint's fifteen plugins actually apply. It reports what to add, or
adds it for you. Run it on a project with no Oxlint config to get a sensible starting
point, or on one that already has a config to see what the stack has outgrown.

```bash
npx oxc-audit            # report only
npx oxc-audit --write    # apply the recommendations
```

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
  rule react/jsx-no-target-blank: error [jsx]
      `target="_blank"` without `rel="noreferrer"` exposes `window.opener`.

  Run with --write to apply these to /project/.oxlintrc.json
```

Every recommendation names the signals that triggered it and why it exists. Nothing is
recommended without evidence in the project.

## Two properties it guarantees

**Deterministic.** Every signal is a fact read off disk: a declared dependency, a config
file that exists, a file extension actually present in the tree. There are no heuristics,
no scoring, and no network calls. The same project always produces the same output, which
is what makes it safe in CI.

**Additive.** A run can only ever add checks. Three invariants hold for any input:

1. **Nothing is removed.** No rule, plugin, category, override, or unrecognised field is
   dropped — including fields this tool does not understand.
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
| `tsconfig`            | `tsconfig.json` (tracked separately — type-aware linting needs a real one)    |
| `tsgolint`            | `oxlint-tsgolint` dependency                                                  |
| `jsdoc`               | `jsdoc` or `typedoc` dependency                                               |

Dependencies are read from `dependencies`, `devDependencies`, and `peerDependencies`, so a
monorepo leaf package that inherits a framework is still detected.

Oxlint parses `.vue`, `.svelte`, and `.astro` and lints their script blocks with its
universal rules, but ships a dedicated plugin only for Vue. Svelte and Astro are still
detected, and the missing plugin is reported rather than silently producing nothing.

**Workspace roots.** Dependency signals come from one manifest. In a workspace root the
frameworks live in the leaf packages, so a root-level audit under-reports — the tool says
so and suggests running per package with `--dir`.

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
      3 type-aware rules (including no-floating-promises) need type information,
      which Oxlint gets from the tsgolint engine.
      pnpm add -D oxlint-tsgolint
```

Recommended type-aware rules are checked against `docs/tsgolint-rules.tsv` **including its
`status` column**, so a rule tsgolint has not implemented yet can never be recommended —
that would configure something which silently never runs.

## Usage

```
oxc-audit [options]

  -d, --dir <path>       Project directory to audit (default: current directory)
  -c, --config <path>    Path to the Oxlint config (default: .oxlintrc.json)
  -w, --write            Apply the recommendations. Without this the audit only reports.
      --no-backup        Skip writing a .backup copy before applying changes
      --max-files <n>    Maximum source files to scan before truncating
      --json             Print the audit report as JSON to stdout
  -v, --verbose          Show detailed progress information
  -h, --help             Display help
  -V, --version          Display version
```

Exit code is `0` when the audit succeeds and `1` when it hits an error or a blocker.

### Library

```ts
import { audit, detectStack, recommendForStack, mergeRecommendations } from 'oxc-audit'

const report = await audit({ projectDir: process.cwd() })

for (const recommendation of report.recommendations) {
  console.log(recommendation.target, '←', recommendation.triggeredBy.join(', '))
}
```

`detectStack`, `recommendForStack`, and `mergeRecommendations` are exported separately so
you can substitute your own recommendation table while keeping the detection and the
merge invariants.

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

Recommended rule and plugin names are checked against the tracked inventories in
`docs/oxlint-rules.tsv` and `docs/tsgolint-rules.tsv`, so a rename upstream fails the
suite rather than shipping a config referencing a rule that no longer exists.

## License

MIT
