# oxlint-audit-plugins

Oxlint rules extracted from the version-locked stack audit prompts in
`prompts/prompts/audit/`. Each prompt is a checklist an AI runs against a codebase; the
mechanically-detectable half of those checklists is what lives here, so the same findings
surface in the editor and in CI instead of only during a review pass.

Five independent plugins, each loadable on its own so a project only pays for the stacks it
actually uses:

| Plugin | Entry point | Covers |
| --- | --- | --- |
| `next-react` | `./src/next-react/index.ts` | Next.js 16 / React 19 migration residue |
| `data-layer` | `./src/data-layer/index.ts` | Zod 4, TanStack Query 5, Zustand 5, RHF 7, Drizzle 1.0 |
| `ai-integrations` | `./src/ai-integrations/index.ts` | AI SDK v6 -> v7, Stripe webhooks and v22 |
| `ts-tooling` | `./src/ts-tooling/index.ts` | Vitest 4, Vite 8 config |
| `slop-stop` | `./src/slop-stop/index.ts` | Type-evidence laundering; stack-independent |
| `supabase` | `./src/supabase/index.ts` | Supabase auth, client boundaries, error envelopes |
| `web-security` | `./src/web-security/index.ts` | OWASP Top 10:2025; stack-independent |

## What these rules are for

Almost every rule here targets the same failure mode: **code that still type-checks and still
runs, but no longer does what it says.** A removed Zod parameter is ignored rather than
rejected. A v4 TanStack Query `onSuccess` never fires. An un-awaited `cookies()` returns a
truthy Promise. That is the class of problem a linter is uniquely good at and a test suite is
uniquely bad at, because nothing fails.

Findings that *do* fail loudly (renamed exports, removed modules) are included where they are
the residue a partly-applied codemod leaves behind.

## Usage

```jsonc
// .oxlintrc.json
{
  "jsPlugins": [
    "./node_modules/oxlint-audit-plugins/src/data-layer/index.ts",
    "./node_modules/oxlint-audit-plugins/src/next-react/index.ts"
  ],
  "rules": {
    "data-layer/no-zod-string-format-methods": "warn",
    "next-react/require-await-next-request-apis": "error"
  }
}
```

A ready-made preset with every rule plus the built-in and type-aware rules that cover the rest
of the audit checklists ships as `oxlintrc.audit.json`:

```bash
oxlint -c node_modules/oxlint-audit-plugins/oxlintrc.audit.json .
oxlint -c node_modules/oxlint-audit-plugins/oxlintrc.audit.json --type-aware .   # needs a tsconfig
oxlint -c node_modules/oxlint-audit-plugins/oxlintrc.audit.json --fix .
```

`jsPlugins` paths in the preset are relative to the preset file, so it works in place. Copy it
into the consuming project if you want to change severities.

The preset is not custom rules alone. It enables Oxlint's own `typescript`, `unicorn`, `import`,
`promise`, `vitest`, `oxc`, `react` and `nextjs` plugins alongside them, and states
`categories: { correctness: error }` rather than relying on Oxlint's implicit default. The custom
plugins cover what the built-ins do not; running them without the built-ins would catch the
migration residue and miss the ordinary mistakes.

`suspicious` is left off deliberately: it carries `react/react-in-jsx-scope`, which is wrong for
every project on the React 17+ JSX transform.

## Rules

### `next-react`

| Rule | Fix | What it catches |
| --- | --- | --- |
| `no-cache-primitive-outside-server-action` | — | `updateTag()` / `refresh()` outside a Server Action, where Next.js throws at request time. |
| `no-dynamic-before-interactive-script` | — | A computed `src` on `<Script strategy="beforeInteractive">`, which executes before React can gate it (GHSA-gx5p-jg67-6x7h). |
| `no-client-hooks-in-server-component` | — | `useState`/`useEffectEvent`/… imported into an `app/` module with no `"use client"`. Scoped to `app/` so component libraries and Pages Router trees are untouched. |
| `no-edge-runtime` | — | `export const runtime = 'edge'`, deprecated in 16.3. |
| `no-legacy-context-provider` | yes | `<Context.Provider>` where `Context` is traceably a `createContext()` result. Third-party `<X.Provider>` namespaces are not reported. |
| `no-legacy-next-modules` | — | `next/legacy/image`, `unstable_cache`, `unstable_catchError`/`unstable_retry`, `useFormState`, `forwardRef`. |
| `no-middleware-file` | — | The `middleware.ts` filename, renamed to `proxy.ts` in 16. |
| `no-removed-next-config-keys` | — | `images.domains`, `publicRuntimeConfig`, `serverRuntimeConfig`, `experimental.ppr`, `experimental.useCache`. Only inside `next.config.*`. |
| `require-await-next-request-apis` | — | Un-awaited `cookies()`, `headers()`, `draftMode()`, `connection()`. |

### `data-layer`

| Rule | Fix | What it catches |
| --- | --- | --- |
| `no-drizzle-legacy-api` | partial | RQBv1 `_query`, instance-level `casing`, moved `pg-core` subpaths. |
| `no-react-query-removed-exports` | yes | `Hydrate`, top-level `isServer`. |
| `no-react-query-v4-options` | partial | `cacheTime`, `useErrorBoundary`, `suspense`, and query-level `onSuccess`/`onError`/`onSettled`. Mutation callbacks are left alone — they are still current. |
| `no-field-array-index-key` | — | `key={index}` on a `useFieldArray` list; the index shifts on `remove`/`swap` so inputs keep the previous row's value. |
| `require-async-parse-for-async-schema` | — | Sync `.parse()` on a schema with an async refinement, which throws when it reaches one. |
| `no-rhf-setvalue-loop` | — | `setValue` in a loop or per-element callback; use `setValues`. |
| `no-zod-legacy-error-params` | partial | `errorMap`, `invalid_type_error`, `required_error`. |
| `no-zod-removed-methods` | — | `.deepPartial()`, `.nativeEnum()`, `.passthrough()`, `.strip()`, `.merge()`. |
| `no-zod-safe-parse-json-parse` | — | `schema.safeParse(JSON.parse(text))` — the argument is evaluated first, so malformed JSON throws at the one call site written not to. |
| `no-zod-shape-spread-drops-refinements` | — | `z.object({ ...base.shape })` where `base` carries `.refine()`/`.superRefine()`/`.check()`. Same keys, same inferred type, no checks. |
| `no-zod-single-arg-record` | yes | `z.record(valueSchema)` without a key schema. |
| `no-zod-string-format-methods` | yes | `z.string().email()` -> `z.email()`, `.datetime()` -> `z.iso.datetime()`. |
| `no-zod-to-json-schema-package` | — | `zod-to-json-schema`, `@anatine/zod-openapi`. |
| `no-zod-trim-after-min-length` | — | `z.string().min(1).trim()` — `"   "` passes the non-empty check and then parses to `""`. Only `.min(1)` is reported; a longer minimum may deliberately measure the raw input. |
| `no-zustand-v4-import-paths` | yes | `zustand/react/shallow`, `zustand/middleware/devtools`. |
| `require-zustand-curried-create` | — | `create<T>(init)` instead of `create<T>()(init)`. |

### `ai-integrations`

| Rule | Fix | What it catches |
| --- | --- | --- |
| `no-ai-v6-exports` | yes | `CoreMessage`, `CoreTool`, `convertToCoreMessages`, `stepCountIs`, `createGoogleGenerativeAI`, … |
| `no-ai-v6-options` | partial | `system`, `onFinish`, `maxTokens`, `maxSteps`, `parameters`, surviving `experimental_` keys. |
| `no-ai-v6-result-members` | — | `fullStream`, `totalUsage`, `partialObjectStream`, result-method response helpers. |
| `no-stripe-unverified-webhook` | — | `constructEventWithoutVerification` / `parseEventNotificationWithoutVerification`. |
| `no-stripe-v21-api` | — | `Stripe()` without `new`; the renamed `Stripe.StripeContext` type. |
| `require-stripe-async-webhook` | partial | Sync `constructEvent` / `parseEventNotification`, which throw on edge runtimes. |

### `ts-tooling`

| Rule | Fix | What it catches |
| --- | --- | --- |
| `no-removed-vitest-config` | — | `workspace`, `minWorkers`, `environmentMatchGlobs`, `poolMatchGlobs`; the Vite 8 `server.hmr` -> `server.ws` rename. |
| `no-removed-vitest-exports` | partial | `ErrorWithDiff`, `UserConfig`, Node-only types that moved to `vitest/node`. |

### `supabase`

Security rules rather than migration rules — the CRITICAL section of `supabase.md`.

| Rule | Fix | What it catches |
| --- | --- | --- |
| `no-browser-client-on-server` | — | `createBrowserClient` in a module without `"use client"`, where there is no `document.cookie`. |
| `no-deprecated-auth-helpers` | — | `@supabase/auth-helpers-*` packages and their per-context client factories. |
| `no-get-session-for-authorization` | — | Server-side `getSession()`, which returns the cookie without validating it — a forged cookie passes. |
| `no-module-scope-server-client` | — | Module-scope `createServerClient`, which pins one request's cookies and serves that session to later users. |
| `require-error-check` | — | `const { data } = await supabase.from(...)` — Supabase resolves failures as `{ data: null, error }` rather than throwing, so an RLS denial reads as an empty table. |

### `web-security`

Stack-agnostic, applicable to any JS/TS project. Scoped to what has no oxlint built-in.

| Rule | Fix | What it catches |
| --- | --- | --- |
| `no-hardcoded-credential` | — | AWS, Google, GitHub, Slack, Stripe, Supabase and npm tokens, plus private key blocks — matched by credential format, not by variable naming. |
| `no-insecure-randomness` | — | `Math.random()` for tokens, secrets, nonces, salts and IDs. |
| `no-shell-injection` | — | Interpolated command strings passed to `exec` / `execSync`. |
| `require-sanitized-html` | — | `dangerouslySetInnerHTML` / `innerHTML` given a value that is neither a literal nor a sanitiser call. |

`require-sanitized-html` is the narrower alternative to the built-in `react/no-danger`, which
bans the prop outright. **Enable one or the other, not both** — this rule permits the sanitised
form, so legitimate rich-text rendering does not need a disable comment on every occurrence.
The preset enables this rule and leaves `react/no-danger` off.

### `slop-stop`

The odd one out: not tied to a library version, and not about code that stopped working. These
target code that *knows* a precise type and then throws it away, so a later reader — human or
model — has to guess what the value really is.

| Rule | Fix | What it catches |
| --- | --- | --- |
| `no-chained-type-assertions` | — | `x as unknown as T` and its angle-bracket and parenthesised spellings. Chains of `as const` are allowed; a chain reports once, at its outermost link. |
| `no-known-value-widening` | — | Annotating a literal, object or array with `unknown`, `object` or an open dictionary, discarding what was already inferred. |
| `no-unsafe-dictionary-type` | — | `Record<string, unknown>` / index signatures of `any`, `{}`, `object` for a shape the owner knows. Resolves through aliases, `Readonly`/`Partial` wrappers and generic parameters, and stands down when a built-in name is locally shadowed. |
| `no-widen-then-assert` | — | A `const` widened to `unknown`/`object`/`Record<…, unknown>` and later asserted back to something narrower, inside one function body. |
| `require-safety-comment-for-type-assertion` | — | Any non-`const` assertion with no `SAFETY:` comment on it or its statement. |

Two caveats worth knowing before enabling these:

- **They are syntactic, by necessity.** Custom JS plugins get no type information (see below), so
  each rule keys off what the *annotation* says rather than what the type actually is. With
  `--type-aware` available, `typescript/no-unsafe-type-assertion` subsumes
  `no-chained-type-assertions` and is strictly better; the syntactic version earns its place in
  runs without a tsconfig.
- **`require-safety-comment-for-type-assertion` is a policy, not a defect detector.** It fires on
  every assertion in a codebase that has never used the convention, which is why the preset ships
  it as `warn`.

Three limits shaped the scope, and the preset compensates for them where it can.

**oxfmt has no plugin API.** It is an opinionated formatter with no rule surface at all, so
none of the audit findings map onto it. Formatting-adjacent items stay with oxlint.

**Custom JS plugins cannot use type information.** Oxlint's type-aware mode (`--type-aware`,
via `oxlint-tsgolint`) runs built-in rules only. So the audit prompts' "Errors" and "Types"
sections — swallowed errors, unhandled rejections, `any` casts, non-exhaustive switches,
unsafe assertions — are covered in the preset by real type-aware rules rather than by
approximations here:

| Audit checklist item | Rule the preset enables |
| --- | --- |
| Unhandled promises / missing `await` | `typescript/no-floating-promises`, `typescript/await-thenable`, `typescript/no-misused-promises` |
| Error swallowing, log-and-continue | `no-empty` (no `allowEmptyCatch`), `no-useless-catch`, `promise/catch-or-return` |
| Non-`Error` throws | `typescript/only-throw-error`, `typescript/prefer-promise-reject-errors`, `unicorn/prefer-type-error` |
| `any` casts, unsafe assertions | `typescript/no-explicit-any`, `typescript/no-unsafe-{argument,assignment,call,member-access,return}`, `typescript/consistent-type-assertions` |
| Non-exhaustive switches (incl. the Stripe 22.4 open-enum break) | `typescript/switch-exhaustiveness-check`, `typescript/no-unsafe-enum-comparison` |
| `@ts-ignore` suppressions | `typescript/ban-ts-comment` |

**The injection primitives already have built-ins.** `web-security` covers only what oxlint
does not: the preset enables `no-eval`, `no-new-func`, `no-implied-eval`, `no-script-url` and
`unicorn/require-post-message-target-origin` alongside it.

**Some findings are already native oxlint rules.** Where one exists, the preset enables it rather
than a custom equivalent:

- un-awaited async assertions -> `vitest/valid-expect` (with `asyncMatchers`) and
  `vitest/require-awaited-expect-poll`
- `vi.mock` / `vi.hoisted` nested in a block -> `vitest/hoisted-apis-on-top`
- `JSON.parse(JSON.stringify(x))` as a deep clone -> `unicorn/prefer-structured-clone`

**House style is out of scope.** These plugins report defects — code that does something other
than what it says. Rules that mandate a project's conventions instead (banning `unknown` or
`typeof` outright, requiring a file layout, forbidding `vi.mock` in favour of dependency
injection) do not belong in a preset applied to arbitrary repositories, however defensible they
are inside one team.

Beyond that, plenty of the audit prompts is genuinely not lintable — "lock down the query-key
design", "decide which data belongs in RSC" — and stays in the prompts where it belongs.

## Fix safety

A fix is offered only when the rewrite is behaviour-preserving on its own. Concretely, these
report without a fix on purpose:

- `z.string().min(1).email()` — rewriting to `z.email()` would silently drop the `min(1)` check.
- Named-import forms (`string()` rather than `z.string()`) — the replacement export is not
  necessarily imported.
- Aliased imports (`Hydrate as H`) — call sites use the alias and would need rewriting too.
- `errorMap` — the Zod 4 `error` parameter takes a different callback shape.
- `stripe.webhooks.constructEvent(...)` that is not already awaited — swapping in the async
  helper without an `await` would turn a verified event into an unhandled Promise.

## Development

```bash
pnpm install --ignore-workspace
pnpm check      # lint + typecheck + unit tests + fixture integration run
```

Every rule has a `RuleTester` suite next to it covering the fix output and the near-miss cases
it must not report. `fixtures/` is a small tree of deliberately broken files used as an
end-to-end check that the plugins load and fire under a real `oxlint` run.
