import { defineRule } from "@oxlint/plugins";

import type { ESTree, Fixer } from "@oxlint/plugins";

interface Replacement {
	/** Drop-in name, when the replacement lives in the same module. */
	readonly rename: string | null;
	readonly guidance: string;
}

const REPLACED_EXPORTS = new Map<string, Replacement>([
	["ErrorWithDiff", { rename: "TestError", guidance: "`TestError` replaced it in Vitest 4" }],
	[
		"UserConfig",
		{
			rename: "ViteUserConfig",
			guidance: "`ViteUserConfig` replaced it in Vitest 4",
		},
	],
	[
		"BrowserProvider",
		{
			rename: null,
			guidance: "Node-only types moved out of the main entry — import them from `vitest/node`",
		},
	],
]);

/**
 * Disallow Vitest 3 type exports removed in Vitest 4.
 *
 * These break the config's own type-check rather than a test run, which is exactly why they
 * survive an upgrade in projects that do not type-check their config files.
 */
export const noRemovedVitestExportsRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow Vitest 3 exports removed in Vitest 4 (`ErrorWithDiff`, `UserConfig`, Node-only types moved to `vitest/node`).",
		},
		messages: {
			replacedExport: "`{{name}}` is no longer exported by Vitest 4: {{guidance}}.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				// `vitest/node` is where the moved types now live, so it is never a finding.
				if (node.source.value !== "vitest") return;
				for (const specifier of node.specifiers) {
					if (specifier.type !== "ImportSpecifier") continue;
					const name =
						specifier.imported.type === "Identifier"
							? specifier.imported.name
							: specifier.imported.value;
					const replacement = REPLACED_EXPORTS.get(name);
					if (replacement === undefined) continue;
					const renameable = replacement.rename !== null && specifier.local.name === name;
					context.report({
						node: specifier,
						messageId: "replacedExport",
						data: { name, guidance: replacement.guidance },
						fix: renameable
							? (fixer: Fixer) => fixer.replaceText(specifier, replacement.rename ?? "")
							: undefined,
					});
				}
			},
		};
	},
});
