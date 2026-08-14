import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const REPLACED_PACKAGES = new Map<string, string>([
	["zod-to-json-schema", "the built-in `z.toJSONSchema(schema)`"],
	["@anatine/zod-openapi", "the built-in `z.toJSONSchema(schema)` plus `.meta({ ... })` registries"],
]);

/**
 * Disallow third-party Zod-to-JSON-Schema packages superseded by Zod 4 built-ins.
 *
 * These packages generate against the Zod 3 internals, so on a Zod 4 schema they either fail
 * or emit a JSON Schema that no longer matches what the schema actually parses.
 */
export const noZodToJsonSchemaPackageRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow third-party Zod-to-JSON-Schema packages that Zod 4 replaced with built-in `z.toJSONSchema()`.",
		},
		messages: {
			replacedPackage:
				"`{{package}}` targets Zod 3 internals and drifts from what a Zod 4 schema actually parses. Use {{replacement}}.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				const replacement = REPLACED_PACKAGES.get(node.source.value);
				if (replacement === undefined) return;
				context.report({
					node: node.source,
					messageId: "replacedPackage",
					data: { package: node.source.value, replacement },
				});
			},
		};
	},
});
