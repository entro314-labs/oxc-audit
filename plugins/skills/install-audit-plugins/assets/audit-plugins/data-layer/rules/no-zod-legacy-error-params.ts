import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	importsAnyModule,
	propertyKeyName,
	unwrapExpression,
} from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";

const ZOD_MODULES = ["zod"] as const;

/**
 * Zod 3 error-customization keys. All four collapsed into the single `error` parameter in
 * Zod 4; the names are distinctive enough that matching them inside any object literal in a
 * Zod-importing file does not produce false positives in practice.
 */
const LEGACY_KEYS = new Map<string, string>([
	["errorMap", "error"],
	["invalid_type_error", "error"],
	["required_error", "error"],
]);

/**
 * Disallow the Zod 3 error-customization parameters removed in Zod 4.
 *
 * `errorMap`, `invalid_type_error` and `required_error` are silently ignored by Zod 4 rather
 * than rejected, so a half-migrated schema keeps parsing and quietly loses every custom
 * message it used to produce.
 */
export const noZodLegacyErrorParamsRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow the Zod 3 `errorMap` / `invalid_type_error` / `required_error` parameters, which Zod 4 replaced with the unified `error` parameter and now ignores.",
		},
		messages: {
			legacyKey:
				"`{{key}}` is a Zod 3 parameter that Zod 4 ignores, silently dropping this custom message. Use the unified `error` parameter.",
		},
	},
	createOnce(context) {
		let active = false;

		return {
			Program(node) {
				active = importsAnyModule(collectImportBindings(node), ZOD_MODULES);
			},
			ObjectExpression(node: ESTree.ObjectExpression) {
				if (!active) return;
				for (const property of node.properties) {
					const key = propertyKeyName(property);
					if (key === null) continue;
					const replacement = LEGACY_KEYS.get(key);
					if (replacement === undefined || property.type !== "Property") continue;
					// `errorMap` took `(issue, ctx) => ({ message })` while `error` returns a bare
					// string, so only the string-valued keys can be rewritten mechanically.
					const value = unwrapExpression(property.value);
					const renameable = key !== "errorMap" && !property.shorthand;
					context.report({
						node: property.key,
						messageId: "legacyKey",
						data: { key },
						fix:
							renameable && value.type === "Literal"
								? (fixer: Fixer) => fixer.replaceText(property.key, replacement)
								: undefined,
					});
				}
			},
		};
	},
});
