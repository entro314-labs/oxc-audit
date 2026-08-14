import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	isModuleExport,
	staticMemberName,
	unwrapExpression,
} from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const ZOD_MODULES = ["zod"] as const;

/** `true` for `z.string()` / `string()` reached through any `zod` import. */
function isStringSchemaCall(node: ESTree.Expression, bindings: ImportBindings): boolean {
	return (
		node.type === "CallExpression" &&
		node.arguments.length === 0 &&
		isModuleExport(node.callee, bindings, ZOD_MODULES, "string")
	);
}

/** `true` when a `.min(1)` link sits in the chain below `node`. Only `1` is unambiguous. */
function hasMinimumOne(node: ESTree.Expression): boolean {
	let current = unwrapExpression(node);
	while (current.type === "CallExpression") {
		const { callee } = current;
		if (callee.type !== "MemberExpression") return false;
		if (staticMemberName(callee) === "min") {
			const [argument] = current.arguments;
			if (argument !== undefined && argument.type === "Literal" && argument.value === 1) return true;
		}
		current = unwrapExpression(callee.object);
	}
	return false;
}

/** Walk `.a().b()` links down to the `z.string()` the chain is built on. */
function chainRootsAtStringSchema(node: ESTree.Expression, bindings: ImportBindings): boolean {
	let current = unwrapExpression(node);
	while (current.type === "CallExpression") {
		if (isStringSchemaCall(current, bindings)) return true;
		const { callee } = current;
		if (callee.type !== "MemberExpression") return false;
		current = unwrapExpression(callee.object);
	}
	return false;
}

/**
 * Require `.trim()` before `.min(1)` on a Zod string.
 *
 * Zod applies a chain in order, so `z.string().min(1).trim()` measures the raw input and then
 * trims it: `"   "` passes the non-empty check and parses to `""`. Every consumer downstream
 * believes it holds a non-empty string. `z.string().trim().min(1)` rejects it.
 *
 * Scoped to `.min(1)` on purpose. `.min(2)` or `.max(100)` before a trim can be a deliberate
 * check against the untrimmed input, so reordering those is the author's call, not the linter's.
 *
 * Reported without a fix: swapping the links changes which inputs the schema accepts, which is
 * the point of the finding but not something to apply unattended.
 */
export const noZodTrimAfterMinLengthRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `.trim()` after `.min(1)` on a Zod string schema, where whitespace passes the non-empty check and is then removed.",
		},
		messages: {
			wrongOrder:
				"`.min(1)` runs before `.trim()`, so a whitespace-only string passes the non-empty check and then parses to `\"\"`. Call `.trim()` first.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node) {
				const { callee } = node;
				if (callee.type !== "MemberExpression") return;
				if (staticMemberName(callee) !== "trim") return;
				if (!hasMinimumOne(callee.object)) return;
				if (!chainRootsAtStringSchema(callee.object, bindings)) return;

				context.report({ node, messageId: "wrongOrder" });
			},
		};
	},
});
