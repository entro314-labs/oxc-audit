import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	isModuleExport,
	propertyKeyName,
	staticMemberName,
	unwrapExpression,
} from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const RHF_MODULES = ["react-hook-form"] as const;
const FORM_HOOKS = ["useForm", "useFormContext"] as const;

/** Statement forms whose body runs more than once. */
const LOOP_STATEMENTS = new Set([
	"DoWhileStatement",
	"ForInStatement",
	"ForOfStatement",
	"ForStatement",
	"WhileStatement",
]);
/** Array methods whose callback runs per element. */
const ITERATION_METHODS = new Set(["flatMap", "forEach", "map", "reduce"]);

function isIterationCallback(node: ESTree.Node): boolean {
	if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") return false;
	const { parent } = node;
	if (parent.type !== "CallExpression" || parent.callee.type !== "MemberExpression") return false;
	const method = staticMemberName(parent.callee);
	return method !== null && ITERATION_METHODS.has(method);
}

/** `true` when `node` sits inside a loop body or a per-element callback. */
function isInRepeatedContext(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (LOOP_STATEMENTS.has(current.type)) return true;
		if (isIterationCallback(current)) return true;
		current = current.parent;
	}
	return false;
}

/**
 * Disallow calling `setValue` once per item to write a batch of form values.
 *
 * Each call re-runs validation and dirty-state computation and schedules its own render, so a
 * loop of them produces both an O(n) render storm and a `dirtyFields` tree computed against
 * partially-applied state. `setValues` (7.74) applies the batch in one pass.
 */
export const noRhfSetValueLoopRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow looped `setValue` calls for bulk form updates, which mis-compute dirty state and re-render per item. Use `setValues` instead.",
		},
		messages: {
			loopedSetValue:
				"`setValue` inside a loop re-validates and re-renders per item, and computes dirty state against partially-applied values. Use `setValues` for bulk updates.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		/** Locals bound to a destructured `setValue`. */
		let setValueNames = new Set<string>();
		/** Locals bound to a whole `useForm()` return, for `methods.setValue(...)`. */
		let formObjectNames = new Set<string>();

		const isFormHookCall = (node: ESTree.Expression | null): boolean => {
			if (node === null) return false;
			const call = unwrapExpression(node);
			if (call.type !== "CallExpression") return false;
			return FORM_HOOKS.some((hook) => isModuleExport(call.callee, bindings, RHF_MODULES, hook));
		};

		return {
			Program(node) {
				bindings = collectImportBindings(node);
				setValueNames = new Set();
				formObjectNames = new Set();
			},
			VariableDeclarator(node: ESTree.VariableDeclarator) {
				if (!isFormHookCall(node.init)) return;
				if (node.id.type === "Identifier") {
					formObjectNames.add(node.id.name);
					return;
				}
				if (node.id.type !== "ObjectPattern") return;
				for (const property of node.id.properties) {
					if (propertyKeyName(property) !== "setValue") continue;
					if (property.type !== "Property") continue;
					const local = property.value;
					if (local.type === "Identifier") setValueNames.add(local.name);
				}
			},
			CallExpression(node: ESTree.CallExpression) {
				const callee = unwrapExpression(node.callee);
				const matches =
					callee.type === "Identifier"
						? setValueNames.has(callee.name)
						: callee.type === "MemberExpression" &&
							staticMemberName(callee) === "setValue" &&
							unwrapExpression(callee.object).type === "Identifier" &&
							formObjectNames.has((unwrapExpression(callee.object) as ESTree.IdentifierReference).name);
				if (!matches || !isInRepeatedContext(node)) return;
				context.report({ node, messageId: "loopedSetValue" });
			},
		};
	},
});
