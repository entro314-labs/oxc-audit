import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, resolveTypeBinding } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const STRIPE_MODULES = ["stripe"] as const;

/** Types renamed when v22 turned `Stripe` into a real ES6 class. */
const RENAMED_TYPES = new Map<string, string>([["StripeContext", "StripeContextType"]]);

/**
 * Disallow stripe-node v21 call and type shapes removed in v22.
 *
 * v22 made `Stripe` a real ES6 class, so calling it without `new` throws at construction — the
 * one failure here that is loud. The type renames fail at compile time; the per-request `host`
 * override is the quiet one, silently ignored rather than rejected.
 */
export const noStripeV21ApiRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow stripe-node v21 shapes removed in v22: calling `Stripe()` without `new`, and the renamed `Stripe.StripeContext` type.",
		},
		messages: {
			missingNew:
				"stripe-node v22 made `Stripe` an ES6 class, so calling it without `new` throws. Use `new {{name}}(secretKey)`.",
			renamedType: "`Stripe.{{name}}` was renamed in stripe-node v22. Use `Stripe.{{replacement}}`.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				const { callee } = node;
				if (callee.type !== "Identifier") return;
				const binding = resolveTypeBinding(bindings, callee.name, STRIPE_MODULES);
				if (binding === null || binding.typeOnly) return;
				context.report({ node, messageId: "missingNew", data: { name: callee.name } });
			},
			TSQualifiedName(node: ESTree.TSQualifiedName) {
				if (node.left.type !== "Identifier") return;
				if (resolveTypeBinding(bindings, node.left.name, STRIPE_MODULES) === null) return;
				const { name } = node.right;
				const replacement = RENAMED_TYPES.get(name);
				if (replacement === undefined) return;
				context.report({ node, messageId: "renamedType", data: { name, replacement } });
			},
		};
	},
});
