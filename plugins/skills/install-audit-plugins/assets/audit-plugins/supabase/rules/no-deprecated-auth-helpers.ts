import { defineRule } from "@oxlint/plugins";

import { isFromAnyModule } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

/** The retired auth-helpers packages, superseded wholesale by `@supabase/ssr`. */
const DEPRECATED_PACKAGES = [
	"@supabase/auth-helpers-nextjs",
	"@supabase/auth-helpers-react",
	"@supabase/auth-helpers-remix",
	"@supabase/auth-helpers-shared",
	"@supabase/auth-helpers-sveltekit",
] as const;

/** Per-context factories replaced by the two `@supabase/ssr` clients. */
const REPLACED_FACTORIES = new Map<string, string>([
	["createClientComponentClient", "createBrowserClient"],
	["createMiddlewareClient", "createServerClient"],
	["createRouteHandlerClient", "createServerClient"],
	["createServerComponentClient", "createServerClient"],
]);

/**
 * Disallow the retired `@supabase/auth-helpers-*` packages and their per-context factories.
 *
 * The helpers predate the current cookie contract; mixing them with `@supabase/ssr` in one app
 * produces sessions that refresh in one half of the request path and go stale in the other.
 */
export const noDeprecatedAuthHelpersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow the deprecated `@supabase/auth-helpers-*` packages and their per-context client factories, replaced by `@supabase/ssr`.",
		},
		messages: {
			deprecatedPackage:
				"`{{source}}` is deprecated and predates the current cookie contract. Use `@supabase/ssr` (`createServerClient` / `createBrowserClient`).",
			replacedFactory: "`{{name}}` was replaced by `{{replacement}}` from `@supabase/ssr`.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				const source = node.source.value;
				if (isFromAnyModule(source, DEPRECATED_PACKAGES)) {
					context.report({ node: node.source, messageId: "deprecatedPackage", data: { source } });
					return;
				}
				if (!source.startsWith("@supabase/")) return;
				for (const specifier of node.specifiers) {
					if (specifier.type !== "ImportSpecifier") continue;
					const name =
						specifier.imported.type === "Identifier"
							? specifier.imported.name
							: specifier.imported.value;
					const replacement = REPLACED_FACTORIES.get(name);
					if (replacement === undefined) continue;
					context.report({
						node: specifier,
						messageId: "replacedFactory",
						data: { name, replacement },
					});
				}
			},
		};
	},
});
