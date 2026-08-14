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

/**
 * Disallow the array index as the render key for a `useFieldArray` list.
 *
 * React Hook Form gives every entry a stable `field.id` precisely because the index is not
 * stable: after a `remove(0)` or a `swap`, index 1 names a different row, so React reuses the
 * previous row's DOM node and the uncontrolled input keeps the old value. The symptom is
 * inputs that appear to shuffle their contents on delete.
 */
export const noFieldArrayIndexKeyRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `key={index}` when rendering `useFieldArray` fields; use the stable `field.id` React Hook Form provides.",
		},
		messages: {
			indexKey:
				"The index is not stable across `remove`/`swap`, so React reuses the previous row's inputs and their values appear to shuffle. Use `key={{'{'}}{{field}}.id{{'}'}}`.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		/** Locals bound to the `fields` array returned by `useFieldArray`. */
		let fieldArrayNames = new Set<string>();

		/** The `fields.map((field, index) => …)` callback enclosing this node, if any. */
		const enclosingFieldArrayCallback = (
			node: ESTree.Node,
		): { element: ESTree.Node; index: ESTree.Node } | null => {
			let current: ESTree.Node | null = node.parent;
			while (current !== null && current.type !== "Program") {
				const callback = current;
				current = current.parent;
				if (
					callback.type !== "ArrowFunctionExpression" &&
					callback.type !== "FunctionExpression"
				) {
					continue;
				}
				const call = callback.parent;
				if (call.type !== "CallExpression") continue;
				const callee = unwrapExpression(call.callee);
				if (callee.type !== "MemberExpression" || staticMemberName(callee) !== "map") continue;
				const receiver = unwrapExpression(callee.object);
				if (receiver.type !== "Identifier" || !fieldArrayNames.has(receiver.name)) continue;
				const [element, index] = callback.params;
				if (element !== undefined && index !== undefined) return { element, index };
			}
			return null;
		};

		return {
			Program(node) {
				bindings = collectImportBindings(node);
				fieldArrayNames = new Set();
			},
			VariableDeclarator(node: ESTree.VariableDeclarator) {
				if (node.init === null || node.id.type !== "ObjectPattern") return;
				const init = unwrapExpression(node.init);
				if (init.type !== "CallExpression") return;
				if (!isModuleExport(init.callee, bindings, RHF_MODULES, "useFieldArray")) return;
				for (const property of node.id.properties) {
					if (propertyKeyName(property) !== "fields" || property.type !== "Property") continue;
					const local = property.value;
					if (local.type === "Identifier") fieldArrayNames.add(local.name);
				}
			},
			JSXAttribute(node: ESTree.JSXAttribute) {
				if (node.name.type !== "JSXIdentifier" || node.name.name !== "key") return;
				const { value } = node;
				if (value === null || value.type !== "JSXExpressionContainer") return;
				const expression = unwrapExpression(value.expression as ESTree.Expression);
				if (expression.type !== "Identifier") return;

				const callback = enclosingFieldArrayCallback(node);
				if (callback === null) return;
				if (callback.index.type !== "Identifier" || callback.index.name !== expression.name) {
					return;
				}
				const field =
					callback.element.type === "Identifier" ? callback.element.name : "field";
				context.report({ node, messageId: "indexKey", data: { field } });
			},
		};
	},
});
