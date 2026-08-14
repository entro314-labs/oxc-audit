import { defineRule } from "@oxlint/plugins";

import { propertyKeyName, staticMemberName, unwrapExpression } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

/**
 * Names that mark a value as security-relevant. `Math.random()` is a seeded PRNG whose output
 * is predictable from prior outputs, so any of these derived from it is guessable.
 */
const SECRET_NAME = /(?:api[-_]?key|csrf|nonce|otp|passwd|password|private[-_]?key|salt|secret|session[-_]?id|token|uuid|verifier)/i;

/** How far up the tree to look for a name that gives the value its meaning. */
const NAME_SEARCH_DEPTH = 6;

/** The nearest binding or property name this expression is being given, if any. */
function contextName(node: ESTree.Node): string | null {
	let current: ESTree.Node | null = node.parent;
	for (let depth = 0; current !== null && depth < NAME_SEARCH_DEPTH; depth += 1) {
		if (current.type === "VariableDeclarator" && current.id.type === "Identifier") {
			return current.id.name;
		}
		if (current.type === "Property") return propertyKeyName(current);
		if (current.type === "AssignmentExpression") {
			const target = current.left;
			if (target.type === "Identifier") return target.name;
			if (target.type === "MemberExpression") return staticMemberName(target);
		}
		if (
			current.type === "FunctionDeclaration" ||
			current.type === "FunctionExpression" ||
			current.type === "ArrowFunctionExpression"
		) {
			return current.type === "ArrowFunctionExpression" ? null : (current.id?.name ?? null);
		}
		current = current.parent;
	}
	return null;
}

/**
 * Disallow `Math.random()` for values that carry security weight.
 *
 * `Math.random()` is a fast non-cryptographic PRNG: its internal state is recoverable from a
 * handful of outputs, so every subsequent value is predictable. That is fine for jitter or a
 * placeholder key and disqualifying for anything an attacker benefits from guessing.
 * `crypto.randomUUID()` and `crypto.getRandomValues()` are the drop-in replacements.
 */
export const noInsecureRandomnessRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `Math.random()` for tokens, secrets, nonces, salts and identifiers, where its predictable output is guessable by an attacker.",
		},
		messages: {
			insecureRandom:
				"`Math.random()` is a predictable PRNG — its state is recoverable from previous outputs, so `{{name}}` is guessable. Use `crypto.randomUUID()` or `crypto.getRandomValues()`.",
		},
	},
	createOnce(context) {
		return {
			CallExpression(node: ESTree.CallExpression) {
				const callee = unwrapExpression(node.callee);
				if (callee.type !== "MemberExpression") return;
				if (staticMemberName(callee) !== "random") return;
				const object = unwrapExpression(callee.object);
				if (object.type !== "Identifier" || object.name !== "Math") return;

				const name = contextName(node);
				if (name === null || !SECRET_NAME.test(name)) return;
				context.report({ node, messageId: "insecureRandom", data: { name } });
			},
		};
	},
});
