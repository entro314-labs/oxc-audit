import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, hasDirective, isModuleExport } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const CACHE_MODULE = ["next/cache"] as const;

/** Cache primitives Next.js only permits inside a Server Action. */
const SERVER_ACTION_ONLY = ["refresh", "updateTag"] as const;

/** `true` when this function body opens with a `"use server"` directive. */
function isInlineServerAction(node: ESTree.Node): boolean {
	if (
		node.type !== "FunctionDeclaration" &&
		node.type !== "FunctionExpression" &&
		node.type !== "ArrowFunctionExpression"
	) {
		return false;
	}
	const { body } = node;
	if (body === null || body.type !== "BlockStatement") return false;
	for (const statement of body.body) {
		if (statement.type !== "ExpressionStatement") return false;
		if (statement.directive === undefined || statement.directive === null) return false;
		if (statement.directive === "use server") return true;
	}
	return false;
}

/**
 * Disallow `updateTag()` and `refresh()` outside a Server Action.
 *
 * Both are Server-Action-only by design: they exist to give the caller read-your-own-writes
 * after a mutation, which only means anything inside the action that performed it. Called from
 * a Server Component or a route handler they throw at request time. `revalidateTag()` is the
 * primitive that works outside an action, with eventual-consistency semantics instead.
 */
export const noCachePrimitiveOutsideServerActionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `updateTag()` / `refresh()` outside a Server Action, where Next.js throws at request time.",
		},
		messages: {
			outsideServerAction:
				'`{{name}}()` is Server-Action-only and throws when called from anywhere else. Add a `"use server"` directive to the enclosing function or module, or use `revalidateTag()` if eventual consistency is acceptable.',
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		let isServerActionModule = false;

		return {
			Program(node: ESTree.Program) {
				bindings = collectImportBindings(node);
				isServerActionModule = hasDirective(node, "use server");
			},
			CallExpression(node: ESTree.CallExpression) {
				if (isServerActionModule) return;
				const name = SERVER_ACTION_ONLY.find((primitive) =>
					isModuleExport(node.callee, bindings, CACHE_MODULE, primitive),
				);
				if (name === undefined) return;

				let current: ESTree.Node | null = node.parent;
				while (current !== null) {
					if (isInlineServerAction(current)) return;
					current = current.parent;
				}
				context.report({ node, messageId: "outsideServerAction", data: { name } });
			},
		};
	},
});
