import { defineRule } from "@oxlint/plugins";

import { isFromAnyModule } from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";

const QUERY_MODULES = ["@tanstack/react-query", "@tanstack/query-core"] as const;

interface Replacement {
	/** Drop-in export name, when one exists and the call sites are unchanged. */
	readonly rename: string | null;
	readonly guidance: string;
}

const REPLACED_EXPORTS = new Map<string, Replacement>([
	[
		"Hydrate",
		{ rename: "HydrationBoundary", guidance: "`HydrationBoundary` replaced it in v5" },
	],
	[
		"isServer",
		{
			rename: null,
			guidance: "the top-level flag is deprecated — call `environmentManager.isServer()` instead",
		},
	],
]);

/**
 * Disallow TanStack Query exports removed or deprecated in the v5 line.
 *
 * `Hydrate` is a hard removal that fails at import time; `isServer` still resolves, which is
 * worse — SSR branches keep reading a flag the library no longer maintains.
 */
export const noReactQueryRemovedExportsRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow TanStack Query exports removed or deprecated in v5 (`Hydrate`, top-level `isServer`).",
		},
		messages: {
			replacedExport: "`{{name}}` is no longer the TanStack Query v5 API: {{guidance}}.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				if (!isFromAnyModule(node.source.value, QUERY_MODULES)) return;
				for (const specifier of node.specifiers) {
					if (specifier.type !== "ImportSpecifier") continue;
					const imported =
						specifier.imported.type === "Identifier"
							? specifier.imported.name
							: specifier.imported.value;
					const replacement = REPLACED_EXPORTS.get(imported);
					if (replacement === undefined) continue;
					// Only an unaliased import can be renamed in place; an alias means call sites
					// already use a different name and would need rewriting too.
					const renameable =
						replacement.rename !== null && specifier.local.name === imported;
					context.report({
						node: specifier,
						messageId: "replacedExport",
						data: { name: imported, guidance: replacement.guidance },
						fix: renameable
							? (fixer: Fixer) => fixer.replaceText(specifier, replacement.rename ?? "")
							: undefined,
					});
				}
			},
		};
	},
});
