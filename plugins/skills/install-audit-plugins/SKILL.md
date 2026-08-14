---
name: install-audit-plugins
description: Install and configure the oxlint-audit-plugins plugins (next-react, data-layer, ai-integrations, ts-tooling, slop-stop) in a local TypeScript or JavaScript repository. Use whenever a user asks to add the audit lint rules, copy the audit plugins, catch deprecated framework APIs or migration residue with Oxlint, or configure the shipped audit preset.
---

# Install the audit plugins

Copy the bundled Oxlint plugins into the current repository and wire them into its existing lint
setup. Enable only the plugins the repository's stack justifies — that is the whole point of them
being separate.

## Procedure

1. Inspect the repository before changing it:
   - Read its agent instructions.
   - Check `git status` and preserve unrelated changes.
   - Identify the package manager from `packageManager` and lockfiles.
   - Find the Oxlint configuration (`oxlint.config.*`, `.oxlintrc*`, or a Vite+ config).
   - Check whether a previous copy already exists. Do not overwrite it without reviewing the diff.

2. Establish which plugins apply, from evidence in the repository rather than assumption:

   | Plugin | Enable when |
   | --- | --- |
   | `next-react` | `next` or `react` is a dependency |
   | `data-layer` | `zod`, `@tanstack/react-query`, `zustand`, `react-hook-form` or `drizzle-orm` is a dependency |
   | `ai-integrations` | `ai`, an `@ai-sdk/*` package, or `stripe` is a dependency |
   | `ts-tooling` | `vitest` or `vite` is a dependency |
   | `slop-stop` | any TypeScript source; it is stack-independent |

   Do not enable a plugin whose stack is absent. Its rules would never fire and would only make
   the configuration harder to read.

3. Copy the bundled plugins. Run from the target repository:

   ```bash
   node <skill-directory>/scripts/install.mjs
   ```

   This creates `tools/oxlint/audit-plugins/`. Pass another relative destination as the first
   argument when the repository has an established tooling layout. The script refuses to replace
   an existing destination; only use `--force` after backing up and reviewing existing files.

4. Install current compatible dependencies rather than trusting remembered versions:
   - Query `npm view oxlint version` and `npm view @oxlint/plugins version`.
   - Install the same current version of both with the repository's package manager.
   - `oxlint` is a development dependency. The copied source imports `@oxlint/plugins`, so install
     that as a development dependency too for a local-only plugin.
   - Do not replace the package manager or rewrite unrelated dependency ranges.

5. Register the plugins that step 2 selected. For `oxlint.config.ts` or `.oxlintrc.json`:

   ```jsonc
   {
     "jsPlugins": [
       { "name": "data-layer", "specifier": "./tools/oxlint/audit-plugins/data-layer/index.ts" },
       { "name": "slop-stop", "specifier": "./tools/oxlint/audit-plugins/slop-stop/index.ts" }
     ]
   }
   ```

   For Vite+, add the same entries to `lint.jsPlugins`. Merge with existing entries rather than
   replacing them.

   Enable each selected plugin's rules at the severities in the shipped `oxlintrc.audit.json`,
   which is the reference for both the rule list and the intended severity of each. Rules from
   plugins that were not registered must not be listed.

6. Type-aware rules cover the ground these plugins deliberately do not — unhandled promises,
   swallowed errors, unsafe assertions. If the repository has a `tsconfig.json`, offer to enable
   `"options": { "typeAware": true }` and add `oxlint-tsgolint`. Say plainly that this makes lint
   runs slower, and let the user decide.

7. Run the repository's lint command and typecheck. Report findings. Fix them only when the user
   asked for migration or cleanup. Do not suppress rules, weaken severities, add casts, or
   otherwise launder code to make lint pass — several of these rules exist specifically to catch
   that.

8. Review the final diff and report: copied path, which plugins were enabled and on what
   evidence, dependency versions installed, configuration changed, checks run, findings left.

## Notes

`slop-stop/require-safety-comment-for-type-assertion` fires on every existing type assertion in a
repository that has never used the `SAFETY:` convention. Introduce it as `warn`, or leave it off
until the user asks for it.
