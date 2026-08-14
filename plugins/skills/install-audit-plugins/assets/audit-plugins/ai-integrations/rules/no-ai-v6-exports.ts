import { defineRule } from "@oxlint/plugins";

import { isFromAnyModule } from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";

const AI_MODULES = ["ai", "@ai-sdk"] as const;

/**
 * Exports the v6 -> v7 rename wave touched. All are drop-in renames: same shape, new name, so
 * the import specifier and every reference through it can be rewritten together.
 */
const RENAMED_EXPORTS = new Map<string, string>([
	["CoreMessage", "ModelMessage"],
	["CoreTool", "Tool"],
	["InvalidToolArgumentsError", "InvalidToolInputError"],
	["ToolCallOptions", "ToolExecutionOptions"],
	["convertToCoreMessages", "convertToModelMessages"],
	["createGoogleGenerativeAI", "createGoogle"],
	["experimental_customProvider", "customProvider"],
	["isToolOrDynamicToolUIPart", "isToolUIPart"],
	["stepCountIs", "isStepCount"],
]);

/**
 * Disallow AI SDK v6 export names that v7 renamed.
 *
 * Unlike the option renames these fail loudly at import time — but they are the bulk of what
 * the official codemod leaves behind when it only partly applies, so catching them at lint
 * time keeps the migration honest rather than deferred to the next build.
 */
export const noAiV6ExportsRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow AI SDK v6 export names renamed in v7 (`CoreMessage`, `convertToCoreMessages`, `stepCountIs`, `createGoogleGenerativeAI`, ...).",
		},
		messages: {
			renamedExport: "`{{name}}` was renamed in AI SDK v7. Import `{{replacement}}` instead.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				if (!isFromAnyModule(node.source.value, AI_MODULES)) return;
				for (const specifier of node.specifiers) {
					if (specifier.type !== "ImportSpecifier") continue;
					const name =
						specifier.imported.type === "Identifier"
							? specifier.imported.name
							: specifier.imported.value;
					const replacement = RENAMED_EXPORTS.get(name);
					if (replacement === undefined) continue;
					// Only an unaliased import can be rewritten here; an alias means the call sites
					// already use a different name and are unaffected by the rename.
					context.report({
						node: specifier,
						messageId: "renamedExport",
						data: { name, replacement },
						fix:
							specifier.local.name === name
								? (fixer: Fixer) => fixer.replaceText(specifier, replacement)
								: undefined,
					});
				}
			},
		};
	},
});
