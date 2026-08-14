import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, isModuleExport, staticMemberName } from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const ZOD_MODULES = ["zod"] as const;

/** `z.string().email()` -> `z.email()`: format checks that became top-level schemas in Zod 4. */
const TOP_LEVEL_FORMATS = new Map<string, string>([
	["base64", "base64"],
	["base64url", "base64url"],
	["cuid", "cuid"],
	["cuid2", "cuid2"],
	["e164", "e164"],
	["email", "email"],
	["emoji", "emoji"],
	["guid", "guid"],
	["jwt", "jwt"],
	["ksuid", "ksuid"],
	["nanoid", "nanoid"],
	["ulid", "ulid"],
	["url", "url"],
	["uuid", "uuid"],
	["xid", "xid"],
]);

/** `z.string().datetime()` -> `z.iso.datetime()`: ISO formats moved under the `z.iso` namespace. */
const ISO_FORMATS = new Set(["date", "datetime", "duration", "time"]);

/**
 * Formats with no single top-level equivalent — Zod 4 requires naming the IP/CIDR version
 * explicitly, so these are reported without a fix.
 */
const VERSIONED_FORMATS = new Map<string, string>([
	["cidr", "z.cidrv4() / z.cidrv6()"],
	["ip", "z.ipv4() / z.ipv6()"],
]);

interface StringFormatCall {
	readonly format: string;
	readonly property: ESTree.MemberExpression["property"];
	/**
	 * The `z.string()` call at the root of the chain, present only when the format method sits
	 * directly on it. Intermediate checks (`z.string().min(1).email()`) make a rewrite unsafe,
	 * so those are reported without one.
	 */
	readonly directBase: ESTree.CallExpression | null;
}

/** Walk a `z.string().a().b()` chain down to the `z.string()` call at its root. */
function stringSchemaRoot(
	node: ESTree.Expression,
	bindings: ImportBindings,
): ESTree.CallExpression | null {
	let current = node;
	while (current.type === "CallExpression") {
		if (current.arguments.length === 0 && isModuleExport(current.callee, bindings, ZOD_MODULES, "string")) {
			return current;
		}
		if (current.callee.type !== "MemberExpression") return null;
		current = current.callee.object;
	}
	return null;
}

function matchStringFormatCall(
	node: ESTree.CallExpression,
	bindings: ImportBindings,
): StringFormatCall | null {
	const { callee } = node;
	if (callee.type !== "MemberExpression") return null;
	const format = staticMemberName(callee);
	if (format === null) return null;
	const root = stringSchemaRoot(callee.object, bindings);
	if (root === null) return null;
	return { format, property: callee.property, directBase: root === callee.object ? root : null };
}

/** The `z` in `z.string()`, when the schema was reached through a namespace or default import. */
function namespaceText(base: ESTree.CallExpression, sourceText: string): string | null {
	const { callee } = base;
	if (callee.type !== "MemberExpression") return null;
	return sourceText.slice(callee.object.start, callee.object.end);
}

/**
 * Disallow Zod 3 string-method format checks that Zod 4 replaced with top-level schemas.
 *
 * The method forms still parse, so nothing fails loudly — but they are the migration residue
 * Zod 4 documents against, producing weaker error codes and worse `z.toJSONSchema()` output
 * than their top-level equivalents.
 */
export const noZodStringFormatMethodsRule = defineRule({
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description:
				"Disallow Zod 3 string-method format checks (`z.string().email()`) in favour of the Zod 4 top-level format schemas (`z.email()`).",
		},
		messages: {
			topLevel: "`.{{format}}()` on `z.string()` is Zod 3 syntax. Use the top-level `z.{{replacement}}()`.",
			iso: "`.{{format}}()` on `z.string()` is Zod 3 syntax. ISO formats moved to `z.iso.{{format}}()`.",
			versioned:
				"`.{{format}}()` on `z.string()` is Zod 3 syntax and has no single Zod 4 equivalent. Choose a version explicitly: {{replacement}}.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node) {
				const match = matchStringFormatCall(node, bindings);
				if (match === null) return;
				const { format, property, directBase } = match;

				const versioned = VERSIONED_FORMATS.get(format);
				if (versioned !== undefined) {
					context.report({ node, messageId: "versioned", data: { format, replacement: versioned } });
					return;
				}

				const isIso = ISO_FORMATS.has(format);
				const replacement = TOP_LEVEL_FORMATS.get(format);
				if (!isIso && replacement === undefined) return;

				// A fix is only offered for `z.string().fmt()` reached through a namespace import: a
				// named import (`string()`) would need the replacement export added to the import
				// statement, and an intermediate check would be dropped by the rewrite.
				const namespace = directBase === null ? null : namespaceText(directBase, context.sourceCode.text);
				const fix =
					directBase === null || namespace === null
						? undefined
						: (fixer: Fixer) =>
								fixer.replaceTextRange(
									[directBase.start, property.end],
									isIso ? `${namespace}.iso.${format}` : `${namespace}.${replacement}`,
								);

				context.report(
					isIso
						? { node, messageId: "iso", data: { format }, fix }
						: { node, messageId: "topLevel", data: { format, replacement: replacement ?? "" }, fix },
				);
			},
		};
	},
});
