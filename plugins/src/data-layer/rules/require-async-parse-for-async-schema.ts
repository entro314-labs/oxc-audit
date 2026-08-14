import { defineRule } from "@oxlint/plugins";

import { staticMemberName, unwrapExpression } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

/** Zod checks whose callback may be asynchronous. */
const CHECK_METHODS = new Set(["check", "refine", "superRefine", "transform"]);

/** Sync parse entrypoints, mapped to their async counterparts. */
const SYNC_PARSERS = new Map<string, string>([
	["parse", "parseAsync"],
	["safeParse", "safeParseAsync"],
]);

function isAsyncFunction(node: ESTree.Node): boolean {
	return (
		(node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") && node.async
	);
}

/** `true` when any check in the chain was given an async callback. */
function hasAsyncCheck(node: ESTree.Expression): boolean {
	let current = unwrapExpression(node);
	for (;;) {
		if (current.type === "CallExpression") {
			const callee = unwrapExpression(current.callee);
			if (callee.type === "MemberExpression") {
				const method = staticMemberName(callee);
				if (
					method !== null &&
					CHECK_METHODS.has(method) &&
					current.arguments.some((argument) => isAsyncFunction(argument))
				) {
					return true;
				}
			}
			current = callee;
			continue;
		}
		if (current.type === "MemberExpression") {
			current = unwrapExpression(current.object);
			continue;
		}
		return false;
	}
}

/**
 * Require `parseAsync` on schemas carrying async checks.
 *
 * Zod throws when a synchronous `.parse()` reaches an async refinement — but only on the input
 * that actually gets that far, so the failure surfaces as a runtime error on one code path
 * rather than at the schema definition. Only schemas whose async check is visible in the same
 * module are tracked.
 */
export const requireAsyncParseForAsyncSchemaRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require `parseAsync` / `safeParseAsync` on Zod schemas whose refinements are async, since the sync parsers throw when they reach one.",
		},
		messages: {
			syncParseOnAsyncSchema:
				"`{{schema}}` has an async check, and `{{method}}` throws when it reaches one. Use `{{replacement}}` and await it.",
		},
	},
	createOnce(context) {
		/** Locals bound to a schema with at least one async check. */
		let asyncSchemas = new Set<string>();

		return {
			Program() {
				asyncSchemas = new Set();
			},
			VariableDeclarator(node: ESTree.VariableDeclarator) {
				if (node.init === null || node.id.type !== "Identifier") return;
				if (!hasAsyncCheck(node.init)) return;
				asyncSchemas.add(node.id.name);
			},
			CallExpression(node: ESTree.CallExpression) {
				const callee = unwrapExpression(node.callee);
				if (callee.type !== "MemberExpression") return;
				const method = staticMemberName(callee);
				if (method === null) return;
				const replacement = SYNC_PARSERS.get(method);
				if (replacement === undefined) return;
				const receiver = unwrapExpression(callee.object);
				if (receiver.type !== "Identifier" || !asyncSchemas.has(receiver.name)) return;
				context.report({
					node,
					messageId: "syncParseOnAsyncSchema",
					data: { schema: receiver.name, method, replacement },
				});
			},
		};
	},
});
