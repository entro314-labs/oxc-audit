import { defineRule } from "@oxlint/plugins";

import { findProperty, staticMemberName, unwrapExpression } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

/**
 * Calls treated as producing trusted HTML. Matching is by function name rather than by import,
 * so a project wrapper called `sanitizeHtml` counts — the point is to require that a
 * sanitisation step exists and is visible at the injection site.
 */
const SANITIZER_NAMES = new Set([
	"clean",
	"purify",
	"sanitize",
	"sanitizeHtml",
	"sanitizeHTML",
	"xss",
]);

/** Properties that parse their assigned string as HTML. */
const HTML_SINKS = new Set(["innerHTML", "outerHTML"]);

/** `true` when the expression is a literal or a call to something that sanitises. */
function isTrustedHtml(node: ESTree.Expression): boolean {
	const value = unwrapExpression(node);
	// A string literal or a template with no interpolation is author-controlled.
	if (value.type === "Literal") return true;
	if (value.type === "TemplateLiteral") return value.expressions.length === 0;
	if (value.type !== "CallExpression") return false;
	const callee = unwrapExpression(value.callee);
	if (callee.type === "Identifier") return SANITIZER_NAMES.has(callee.name);
	if (callee.type !== "MemberExpression") return false;
	const method = staticMemberName(callee);
	return method !== null && SANITIZER_NAMES.has(method);
}

/**
 * Require HTML sinks to receive sanitised input.
 *
 * `dangerouslySetInnerHTML` and `innerHTML` parse their input as markup, so any attacker-
 * controlled substring becomes an element — most usefully an `onerror` handler on a broken
 * `<img>`, which needs no `<script>` tag and survives most naive filtering.
 *
 * This is the narrower alternative to the built-in `react/no-danger`, which bans the prop
 * outright. Enable one or the other, not both: this rule permits the sanitised form so
 * legitimate rich-text rendering does not need a disable comment on every occurrence.
 */
export const requireSanitizedHtmlRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require `dangerouslySetInnerHTML` and `innerHTML` assignments to receive a literal or the result of a sanitiser call.",
		},
		messages: {
			unsanitizedJsx:
				"`dangerouslySetInnerHTML` parses this value as markup, so any attacker-controlled substring becomes an element. Pass the result of a sanitiser (for example `DOMPurify.sanitize(html)`).",
			unsanitizedSink:
				"Assigning to `{{sink}}` parses this value as markup, so any attacker-controlled substring becomes an element. Sanitise it first, or use `textContent` if it is meant to be text.",
		},
	},
	createOnce(context) {
		return {
			JSXAttribute(node: ESTree.JSXAttribute) {
				if (node.name.type !== "JSXIdentifier" || node.name.name !== "dangerouslySetInnerHTML") {
					return;
				}
				const { value } = node;
				if (value === null || value.type !== "JSXExpressionContainer") return;
				const { expression } = value;
				if (expression.type !== "ObjectExpression") return;
				const html = findProperty(expression, "__html");
				if (html === null || isTrustedHtml(html.value)) return;
				context.report({ node, messageId: "unsanitizedJsx" });
			},
			AssignmentExpression(node: ESTree.AssignmentExpression) {
				const target = node.left;
				if (target.type !== "MemberExpression") return;
				const sink = staticMemberName(target);
				if (sink === null || !HTML_SINKS.has(sink)) return;
				if (isTrustedHtml(node.right)) return;
				context.report({ node, messageId: "unsanitizedSink", data: { sink } });
			},
		};
	},
});
