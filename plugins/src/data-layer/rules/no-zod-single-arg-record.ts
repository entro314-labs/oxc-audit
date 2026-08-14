import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, isModuleExport } from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const ZOD_MODULES = ["zod"] as const;

/**
 * Require both a key and a value schema on `z.record()`.
 *
 * Zod 4 restored the single-argument form as a compatibility shim, so this does not throw —
 * but the two-argument form is the documented API, and it is the only one that runs key
 * transforms and reports key failures as `invalid_key`.
 */
export const noZodSingleArgRecordRule = defineRule({
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description:
				"Require the Zod 4 two-argument `z.record(keySchema, valueSchema)` form instead of the Zod 3 single-argument compatibility shim.",
		},
		messages: {
			singleArgument:
				"`z.record(valueSchema)` is the Zod 3 form. Pass an explicit key schema: `z.record(z.string(), valueSchema)`.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				if (node.arguments.length !== 1) return;
				if (!isModuleExport(node.callee, bindings, ZOD_MODULES, "record")) return;
				const [valueSchema] = node.arguments;
				// A spread argument carries an unknown arity, so there is nothing safe to prepend.
				if (valueSchema === undefined || valueSchema.type === "SpreadElement") return;
				const namespace =
					node.callee.type === "MemberExpression"
						? context.sourceCode.text.slice(node.callee.object.start, node.callee.object.end)
						: null;
				context.report({
					node,
					messageId: "singleArgument",
					fix:
						namespace === null
							? undefined
							: (fixer: Fixer) => fixer.insertTextBefore(valueSchema, `${namespace}.string(), `),
				});
			},
		};
	},
});
