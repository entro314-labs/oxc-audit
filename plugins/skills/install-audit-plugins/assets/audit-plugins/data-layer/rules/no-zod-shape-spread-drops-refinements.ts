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
const OBJECT_CONSTRUCTORS = ["object", "strictObject", "looseObject"] as const;

/** Chain links that attach a check the rebuilt object would not carry. */
const REFINEMENT_METHODS = new Set(["check", "refine", "superRefine"]);

/** `true` when any `.method()` link in the chain rooted at `node` attaches a refinement. */
function chainAttachesRefinement(node: ESTree.Expression): boolean {
	let current = unwrapExpression(node);
	while (current.type === "CallExpression") {
		const { callee } = current;
		if (callee.type !== "MemberExpression") return false;
		const method = staticMemberName(callee);
		if (method !== null && REFINEMENT_METHODS.has(method)) return true;
		current = unwrapExpression(callee.object);
	}
	return false;
}

/** The `z.object({ … })` call this spread is being rebuilt into, or `null`. */
function enclosingObjectConstructor(
	node: ESTree.SpreadElement,
	bindings: ImportBindings,
): ESTree.CallExpression | null {
	const object = node.parent;
	if (object.type !== "ObjectExpression") return null;
	const call = object.parent;
	if (call.type !== "CallExpression" || call.arguments[0] !== object) return null;
	return OBJECT_CONSTRUCTORS.some((name) =>
		isModuleExport(call.callee, bindings, ZOD_MODULES, name),
	)
		? call
		: null;
}

/**
 * Disallow rebuilding a refined Zod object from its `.shape`.
 *
 * `z.object({ ...base.shape, extra })` produces a schema with the same keys and the same
 * inferred type as `base`, so nothing fails to compile and nothing fails at runtime — but every
 * `.refine()` / `.superRefine()` / `.check()` attached to `base` is gone, and inputs it used to
 * reject now parse cleanly. `base.extend({ extra })` keeps them.
 *
 * The base schema is matched by name against `const`/`let` declarators seen earlier in the file,
 * which is the shape this pattern takes in practice; a base built inline or imported from
 * another module is left alone rather than guessed at.
 */
export const noZodShapeSpreadDropsRefinementsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `{ ...schema.shape }` spreads of a refined Zod object, which silently drop its refinements.",
		},
		messages: {
			dropsRefinements:
				"Spreading `{{base}}.shape` rebuilds the object and drops the refinements attached to `{{base}}`. Use `{{base}}.extend({ … })` so its checks stay active.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		const refinedSchemas = new Set<string>();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
				refinedSchemas.clear();
			},
			VariableDeclarator(node) {
				if (node.id.type !== "Identifier" || node.init === null) return;
				if (chainAttachesRefinement(node.init)) refinedSchemas.add(node.id.name);
			},
			SpreadElement(node) {
				const argument = unwrapExpression(node.argument);
				if (argument.type !== "MemberExpression") return;
				if (staticMemberName(argument) !== "shape") return;

				const base = unwrapExpression(argument.object);
				if (base.type !== "Identifier" || !refinedSchemas.has(base.name)) return;
				if (enclosingObjectConstructor(node, bindings) === null) return;

				context.report({ node, messageId: "dropsRefinements", data: { base: base.name } });
			},
		};
	},
});
