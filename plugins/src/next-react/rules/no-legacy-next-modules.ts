import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/** Whole modules superseded in the Next.js 16 line. */
const LEGACY_MODULES = new Map<string, string>([
	[
		"next/legacy/image",
		"`next/image` — the legacy component predates `remotePatterns` and the current optimizer defaults",
	],
]);

/** Named exports superseded within a module that is otherwise current. */
const LEGACY_EXPORTS = new Map<string, Map<string, string>>([
	[
		"next/cache",
		new Map([
			[
				"unstable_cache",
				"a `'use cache'` boundary with `cacheLife` / `cacheTag` — `unstable_cache` predates Cache Components and does not participate in them",
			],
		]),
	],
	[
		"next/error",
		new Map([
			["unstable_catchError", "`catchError` — the `unstable_` prefix was dropped when it stabilised"],
			["unstable_retry", "`retry` — the `unstable_` prefix was dropped when it stabilised"],
		]),
	],
	[
		"react-dom",
		new Map([["useFormState", "`useActionState` from `react` — `useFormState` is the React 18 name"]]),
	],
	[
		"react",
		new Map([
			[
				"forwardRef",
				"a plain `ref` prop — React 19 passes `ref` through function components directly",
			],
		]),
	],
]);

/**
 * Disallow Next.js and React imports superseded in the Next.js 16 / React 19 line.
 *
 * Every one of these still resolves and still runs, which is exactly why they survive an
 * upgrade: nothing points at them until behaviour diverges from what the code implies.
 */
export const noLegacyNextModulesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow superseded Next.js 16 / React 19 imports (`next/legacy/image`, `unstable_cache`, `unstable_catchError`, `useFormState`, `forwardRef`).",
		},
		messages: {
			legacyModule: "`{{source}}` is superseded in Next.js 16. Use {{guidance}}.",
			legacyExport: "`{{name}}` from `{{source}}` is superseded. Use {{guidance}}.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				const source = node.source.value;

				const moduleGuidance = LEGACY_MODULES.get(source);
				if (moduleGuidance !== undefined) {
					context.report({
						node: node.source,
						messageId: "legacyModule",
						data: { source, guidance: moduleGuidance },
					});
					return;
				}

				const exportGuidance = LEGACY_EXPORTS.get(source);
				if (exportGuidance === undefined) return;
				for (const specifier of node.specifiers) {
					if (specifier.type !== "ImportSpecifier") continue;
					const name =
						specifier.imported.type === "Identifier"
							? specifier.imported.name
							: specifier.imported.value;
					const guidance = exportGuidance.get(name);
					if (guidance === undefined) continue;
					context.report({
						node: specifier,
						messageId: "legacyExport",
						data: { name, source, guidance },
					});
				}
			},
		};
	},
});
