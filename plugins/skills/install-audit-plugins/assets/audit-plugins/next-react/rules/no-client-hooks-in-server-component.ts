import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, hasDirective, isFromAnyModule } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

const REACT_MODULES = ["react"] as const;

/**
 * React hooks that cannot run in a Server Component. `useEffectEvent` is the one React 19.2
 * made an explicit error; the others fail at render with the "only works in a Client
 * Component" message.
 */
const CLIENT_ONLY_HOOKS = new Set([
	"useActionState",
	"useEffect",
	"useEffectEvent",
	"useLayoutEffect",
	"useReducer",
	"useState",
	"useSyncExternalStore",
]);

/**
 * Files under an `app/` directory, where the App Router's server-by-default rule applies.
 * Everything else — `components/`, a Pages Router tree, a plain React app — is exempt.
 */
const APP_ROUTER_FILE = /(^|[\\/])app[\\/]/;

/**
 * Disallow client-only React hooks in App Router modules without a `"use client"` directive.
 *
 * A file under `app/` is a Server Component unless it opts out, so importing `useState` or
 * `useEffectEvent` without the directive fails at render on whichever route happens to reach
 * it — not at build time.
 */
export const noClientHooksInServerComponentRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				'Disallow client-only React hooks in App Router modules that lack a `"use client"` directive, where they fail at render rather than at build.',
		},
		messages: {
			missingUseClient:
				'`{{name}}` only runs in a Client Component, but this module has no `"use client"` directive. Add the directive, or move the hook into a component that has one.',
		},
	},
	createOnce(context) {
		return {
			Program(node: ESTree.Program) {
				if (!APP_ROUTER_FILE.test(context.filename)) return;
				if (hasDirective(node, "use client")) return;
				const bindings = collectImportBindings(node);
				for (const statement of node.body) {
					if (statement.type !== "ImportDeclaration") continue;
					if (!isFromAnyModule(statement.source.value, REACT_MODULES)) continue;
					for (const specifier of statement.specifiers) {
						if (specifier.type !== "ImportSpecifier") continue;
						const name =
							specifier.imported.type === "Identifier"
								? specifier.imported.name
								: specifier.imported.value;
						if (!CLIENT_ONLY_HOOKS.has(name)) continue;
						// A type-only import never reaches the renderer.
						if (bindings.get(specifier.local.name)?.typeOnly === true) continue;
						context.report({ node: specifier, messageId: "missingUseClient", data: { name } });
					}
				}
			},
		};
	},
});
