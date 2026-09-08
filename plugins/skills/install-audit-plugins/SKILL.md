---
name: install-audit-plugins
description: Install and configure the @entro314labs/oxlint-audit-plugins plugins (next-react, data-layer, ai-integrations, ts-tooling, slop-stop, supabase, web-security) in a local TypeScript or JavaScript repository. Use whenever a user asks to add the audit lint rules, install the audit plugins, catch deprecated framework APIs or migration residue with Oxlint, or configure the shipped audit preset.
---

# Install the audit plugins

Add the published plugin package to the current repository and wire the plugins its stack
justifies into the existing Oxlint setup. The package ships compiled JavaScript and declares
`@oxlint/plugins` as a dependency, so one install brings everything a `jsPlugins` entry needs.
Never copy the plugin sources into the repository: Node refuses to strip types from anything
under `node_modules`, and a copy in the tree joins the project's own compilation.

## Procedure

1. Inspect the repository before changing it:
   - Read its agent instructions.
   - Check `git status` and preserve unrelated changes.
   - Identify the package manager from `packageManager` and lockfiles.
   - Find the Oxlint configuration (`oxlint.config.*`, `.oxlintrc*`, or a Vite+ config).

2. Install current versions rather than trusting remembered ones. Query
   `npm view oxlint version` and `npm view @entro314labs/oxlint-audit-plugins version`, then
   install both as development dependencies with the repository's package manager. Do not
   replace the package manager or rewrite unrelated dependency ranges.

3. Prefer letting `oxc-audit` do the wiring. It reads the stack off disk, recommends only the
   plugins the dependencies justify, and merges additively into an existing config:

   ```bash
   npx @entro314labs/oxc-audit            # report what would change
   npx @entro314labs/oxc-audit --write    # apply it
   ```

   It refuses to rewrite a config containing comments and refuses to write `.oxlintrc.json`
   beside an `oxlint.config.*`. In either case, or when the project uses Vite+, register the
   plugins by hand as in step 4.

4. Registering by hand. Establish which plugins apply from evidence in the repository:

   | Plugin | Enable when |
   | --- | --- |
   | `next-react` | `next` or `react` is a dependency |
   | `data-layer` | `zod`, `@tanstack/react-query`, `@tanstack/vue-query`, `zustand`, `react-hook-form` or `drizzle-orm` is a dependency |
   | `ai-integrations` | `ai` or `stripe` is a dependency |
   | `ts-tooling` | `vitest` or `vite` is a dependency |
   | `supabase` | a `@supabase/*` client package is a dependency |
   | `web-security` | any JavaScript or TypeScript source; it is stack-independent |
   | `slop-stop` | any TypeScript source; it is stack-independent |

   Do not enable a plugin whose stack is absent. Its rules would never fire and would only
   make the configuration harder to read. Register the selected plugins by package subpath,
   which Oxlint resolves through the package's `exports` map:

   ```jsonc
   {
     "jsPlugins": [
       "@entro314labs/oxlint-audit-plugins/data-layer",
       "@entro314labs/oxlint-audit-plugins/slop-stop"
     ]
   }
   ```

   For Vite+, add the same entries to `lint.jsPlugins`. Merge with existing entries rather than
   replacing them. Enable each selected plugin's rules at the severities in the package's
   `oxlintrc.audit.json`, which is the reference for both the rule list and the intended
   severity of each. Rules from plugins that were not registered must not be listed.

5. Type-aware rules cover the ground these plugins deliberately do not: unhandled promises,
   swallowed errors, unsafe assertions. If the repository has a `tsconfig.json`, offer to add
   `oxlint-tsgolint` and enable `"options": { "typeAware": true }`. Say plainly that this makes
   lint runs slower, and let the user decide.

6. Run the repository's lint command and typecheck. Report findings. Fix them only when the user
   asked for migration or cleanup. Do not suppress rules, weaken severities, add casts, or
   otherwise launder code to make lint pass; several of these rules exist specifically to catch
   that.

7. Review the final diff and report: dependency versions installed, which plugins were enabled
   and on what evidence, configuration changed, checks run, findings left.

## Notes

`slop-stop/require-safety-comment-for-type-assertion` fires on every existing type assertion in a
repository that has never used the `SAFETY:` convention. Introduce it as `warn`, or leave it off
until the user asks for it. `oxc-audit` never recommends it.

`web-security/require-sanitized-html` and the built-in `react/no-danger` are one-or-the-other:
the plugin rule permits the sanitised form the built-in bans. Enable one, not both.
