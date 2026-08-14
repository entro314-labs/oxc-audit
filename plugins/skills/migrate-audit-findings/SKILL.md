---
name: migrate-audit-findings
description: Work through Oxlint findings from the audit plugins that have no safe autofix — Zod 3 syntax under Zod 4, TanStack Query v4 options, AI SDK v6 exports, un-awaited Next.js request APIs, unverified Stripe webhooks, discarded type evidence. Use when a user asks to fix, migrate, or clear audit lint findings, upgrade a project past a framework major, or resolve oxlint errors from next-react, data-layer, ai-integrations, ts-tooling or slop-stop.
---

# Migrate audit findings

Clear the findings the audit plugins report, in an order that keeps the codebase working at every
step.

The linter is the source of truth for *what* is wrong — every rule states its own replacement in
its message. Do not work from a remembered list of rules; read the actual output. This skill
covers the part the linter cannot do: deciding what a rewrite would change, and proving it did
not change anything else.

## Procedure

1. Establish a baseline before touching anything:
   - `git status` — stop if the tree is dirty, or agree with the user what to preserve.
   - Run the project's test suite and typecheck, and record what already fails. Pre-existing
     failures are not yours to fix and must not be confused with damage from the migration.

2. Find the config to lint with, in this order:
   - the project's own Oxlint config, if it already registers the audit plugins;
   - otherwise `oxlintrc.audit.json` from the package, which enables every rule:
     `oxlint -c node_modules/oxlint-audit-plugins/oxlintrc.audit.json .`

   Add `--type-aware` when the project has a `tsconfig.json` and `oxlint-tsgolint` installed. The
   type-aware rules catch the swallowed errors and unsafe assertions the custom plugins cannot.

3. Take the mechanical fixes first, as their own commit:

   ```bash
   oxlint -c <config> --fix .
   ```

   `--fix` applies only rewrites that preserve behaviour on their own. Read the diff anyway, then
   run the tests. Commit before going further, so the reviewable work is separated from the
   automatic work.

   Never run `--fix-dangerously`. Use `--fix-suggestions` only on a path you are about to review
   line by line — it is documented as possibly changing behaviour.

4. Re-run without `--fix`. What remains is, by construction, the set that needs judgment. Group it
   by rule and work one rule at a time across the whole codebase rather than one file at a time —
   a single rule has a single migration, and doing it in one pass keeps it consistent.

   For each finding, the rule message names the replacement. Before applying it, establish what
   the rewrite changes:
   - **Does it change which inputs are accepted?** Reordering `.trim()` before `.min(1)`, or
     replacing `z.string().min(1).email()` with `z.email()`, changes what the schema rejects.
     That is the point of the finding, but callers may depend on the old behaviour. Check them.
   - **Does it change what runs?** A v4 TanStack Query `onSuccess` never fires today, so removing
     it is not a behaviour change — but the logic inside it may never have run either. Read it
     before deleting it, and tell the user what it was supposed to do.
   - **Does it move an error?** `safeParse(JSON.parse(x))` throws today. Decoding separately means
     the caller now gets a failed result instead of an exception. The caller has to handle it.
   - **Does a name have other call sites?** Aliased imports and renamed exports need every
     reference updated, which is why the rule offers no fix.

   The package README's "Fix safety" section records why each unfixable rule was left that way.
   Read it rather than assuming the fix is mechanical.

5. Handle `slop-stop` findings differently from the version-migration ones. They are not residue
   from an upgrade; they say a type was known and then discarded. The correct resolution is
   almost never a cast:
   - keep the inferred type, or use `satisfies` to check a literal without widening it;
   - give the value a named type owned by the module that produces it;
   - parse untrusted input at its boundary once, then carry the parsed type through.

   Adding `as`, `any`, or a `SAFETY:` comment to silence one of these is the failure mode the
   rules exist to catch. If a cast genuinely is correct, the `SAFETY:` comment must state the
   invariant that makes it correct — not that the code is believed to work.

6. Verify, and report honestly:
   - typecheck and test after each rule's pass, not once at the end;
   - re-run the lint and state how many findings remain and why;
   - if a finding cannot be resolved without a decision the user has to make, leave it and say so.

## Never

- Suppress a finding with a disable comment, a severity downgrade, or removal from the config. If
  a rule does not apply to this project, that is the user's call to make explicitly.
- Add a cast, a non-null assertion, or `any` to make a finding go away.
- Change a test so it passes against the new behaviour without first confirming the new behaviour
  is what was wanted.
- Report the migration as complete while findings remain unmentioned.
