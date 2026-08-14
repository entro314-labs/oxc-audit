import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, isModuleExport } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const ZUSTAND_MODULES = ["zustand"] as const;
const CREATE_EXPORTS = ["create", "createStore"] as const;

/**
 * Require the curried `create<T>()(...)` form when a store type is given explicitly.
 *
 * `create<T>(initializer)` type-checks, but the single call collapses the two inference sites
 * Zustand needs, so every middleware in the chain widens to its base type and the store's
 * actions lose their signatures without a single error being raised.
 */
export const requireZustandCurriedCreateRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require the curried `create<T>()(initializer)` form, because `create<T>(initializer)` silently breaks Zustand middleware type inference.",
		},
		messages: {
			uncurried:
				"`{{name}}<T>(initializer)` breaks middleware type inference. Use the curried form: `{{name}}<T>()(initializer)`.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				// The curried form is `create<T>()` — type arguments present, no value arguments.
				if (node.typeArguments === undefined || node.typeArguments === null) return;
				if (node.arguments.length === 0) return;
				const name = CREATE_EXPORTS.find((exportName) =>
					isModuleExport(node.callee, bindings, ZUSTAND_MODULES, exportName),
				);
				if (name === undefined) return;
				context.report({ node, messageId: "uncurried", data: { name } });
			},
		};
	},
});
