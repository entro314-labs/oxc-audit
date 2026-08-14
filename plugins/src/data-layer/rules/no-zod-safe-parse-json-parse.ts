import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	importsAnyModule,
	staticMemberName,
	unwrapExpression,
} from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const ZOD_MODULES = ["zod"] as const;
const SAFE_PARSE_METHODS = new Set(["safeParse", "safeParseAsync"]);

/** `true` for a call to the global `JSON.parse`. */
function isJsonParseCall(node: ESTree.Expression): boolean {
	const call = unwrapExpression(node);
	if (call.type !== "CallExpression") return false;
	const { callee } = call;
	if (callee.type !== "MemberExpression") return false;
	if (staticMemberName(callee) !== "parse") return false;
	const object = unwrapExpression(callee.object);
	return object.type === "Identifier" && object.name === "JSON";
}

/**
 * Disallow `JSON.parse()` as the argument of a Zod `safeParse()`.
 *
 * `safeParse` exists so bad input returns `{ success: false }` instead of throwing — but its
 * argument is evaluated first, so `schema.safeParse(JSON.parse(text))` still throws a
 * `SyntaxError` on malformed JSON, at the one call site written to prove it cannot throw. The
 * error surfaces as an unhandled exception rather than as a validation failure.
 *
 * Decode first and validate the result: wrap the `JSON.parse` in its own `try`/`catch` (or a
 * Result helper), then hand the decoded value to `safeParse`.
 */
export const noZodSafeParseJsonParseRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `schema.safeParse(JSON.parse(text))`, where malformed JSON throws before `safeParse` can report a failure.",
		},
		messages: {
			throwsBeforeParse:
				"`JSON.parse()` is evaluated before `{{method}}()` runs, so malformed input throws instead of returning a failed result. Decode the JSON separately, then validate the decoded value.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		let importsZod = false;

		return {
			Program(node) {
				bindings = collectImportBindings(node);
				importsZod = importsAnyModule(bindings, ZOD_MODULES);
			},
			CallExpression(node) {
				// `.safeParse()` is distinctive but not unique; requiring a Zod import in the file
				// keeps unrelated parsers with the same method name out of the results.
				if (!importsZod) return;
				const { callee } = node;
				if (callee.type !== "MemberExpression") return;
				const method = staticMemberName(callee);
				if (method === null || !SAFE_PARSE_METHODS.has(method)) return;

				const [argument] = node.arguments;
				if (argument === undefined || argument.type === "SpreadElement") return;
				if (!isJsonParseCall(argument)) return;

				context.report({ node, messageId: "throwsBeforeParse", data: { method } });
			},
		};
	},
});
