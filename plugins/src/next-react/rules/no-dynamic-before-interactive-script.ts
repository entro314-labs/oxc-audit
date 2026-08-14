import { defineRule } from "@oxlint/plugins";

import { unwrapExpression } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

function attributeNamed(node: ESTree.JSXOpeningElement, name: string): ESTree.JSXAttribute | null {
	for (const attribute of node.attributes) {
		if (attribute.type !== "JSXAttribute") continue;
		if (attribute.name.type === "JSXIdentifier" && attribute.name.name === name) return attribute;
	}
	return null;
}

/** `true` when the attribute value is a fixed string rather than a runtime expression. */
function isStaticValue(node: ESTree.JSXAttribute): boolean {
	const { value } = node;
	if (value === null) return true;
	if (value.type === "Literal") return true;
	if (value.type !== "JSXExpressionContainer") return true;
	const expression = unwrapExpression(value.expression as ESTree.Expression);
	if (expression.type === "Literal") return true;
	return expression.type === "TemplateLiteral" && expression.expressions.length === 0;
}

function literalValueOf(node: ESTree.JSXAttribute): string | null {
	const { value } = node;
	if (value === null) return null;
	if (value.type === "Literal") return typeof value.value === "string" ? value.value : null;
	if (value.type !== "JSXExpressionContainer") return null;
	const expression = unwrapExpression(value.expression as ESTree.Expression);
	return expression.type === "Literal" && typeof expression.value === "string"
		? expression.value
		: null;
}

/**
 * Disallow a runtime-computed `src` on a `beforeInteractive` script.
 *
 * `beforeInteractive` injects the tag into the initial HTML, ahead of React and ahead of any
 * hydration-time checks, so whatever the expression resolves to executes with full page
 * privileges before the app can intervene. That is the shape of GHSA-gx5p-jg67-6x7h: a script
 * URL derived from request-controlled input becomes stored XSS. Any other strategy loads after
 * hydration and is a smaller blast radius; a literal `src` is fine at any strategy.
 */
export const noDynamicBeforeInteractiveScriptRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow a computed `src` on a `<Script strategy=\"beforeInteractive\">`, which executes before hydration and cannot be gated by the app.",
		},
		messages: {
			dynamicBeforeInteractive:
				"A `beforeInteractive` script is injected into the initial HTML and runs before React, so a computed `src` executes with full page privileges before anything can check it (GHSA-gx5p-jg67-6x7h). Use a literal `src`, or a later strategy.",
		},
	},
	createOnce(context) {
		return {
			JSXOpeningElement(node: ESTree.JSXOpeningElement) {
				const { name } = node;
				const elementName =
					name.type === "JSXIdentifier"
						? name.name
						: name.type === "JSXMemberExpression"
							? name.property.name
							: null;
				if (elementName !== "Script") return;

				const strategy = attributeNamed(node, "strategy");
				if (strategy === null || literalValueOf(strategy) !== "beforeInteractive") return;

				const src = attributeNamed(node, "src");
				if (src === null || isStaticValue(src)) return;
				context.report({ node: src, messageId: "dynamicBeforeInteractive" });
			},
		};
	},
});
