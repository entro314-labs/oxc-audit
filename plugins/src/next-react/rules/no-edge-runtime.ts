import { defineRule } from "@oxlint/plugins";

import { unwrapExpression } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

/**
 * Disallow the deprecated `export const runtime = 'edge'` route segment config.
 *
 * Next.js 16.3 deprecated the edge runtime in favour of the self-contained runtime. Routes
 * pinned to `'edge'` keep working for now, but they stay on the deprecated path and miss the
 * Node.js-stream SSR and prefetch work that landed on the default runtime.
 */
export const noEdgeRuntimeRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `export const runtime = 'edge'`, deprecated in Next.js 16.3 in favour of the self-contained runtime.",
		},
		messages: {
			edgeRuntime:
				"The edge runtime is deprecated as of Next.js 16.3. Drop this export to use the self-contained runtime, or pin `'nodejs'` deliberately.",
		},
	},
	createOnce(context) {
		return {
			ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
				const { declaration } = node;
				if (declaration === null || declaration.type !== "VariableDeclaration") return;
				for (const declarator of declaration.declarations) {
					if (declarator.id.type !== "Identifier" || declarator.id.name !== "runtime") continue;
					if (declarator.init === null) continue;
					const value = unwrapExpression(declarator.init);
					if (value.type !== "Literal" || value.value !== "edge") continue;
					context.report({ node: declarator, messageId: "edgeRuntime" });
				}
			},
		};
	},
});
