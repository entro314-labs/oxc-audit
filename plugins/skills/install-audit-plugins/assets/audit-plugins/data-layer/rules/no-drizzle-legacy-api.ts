import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	importsAnyModule,
	isModuleExport,
	propertyKeyName,
	staticMemberName,
	unwrapExpression,
} from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const DRIZZLE_MODULES = ["drizzle-orm"] as const;

/** Subpaths that moved in the Drizzle 1.0 line. */
const MOVED_PATHS = new Map<string, string>([
	["drizzle-orm/pg-core/utils", "drizzle-orm/pg-core/array"],
	["drizzle-orm/pg-core/utils/array", "drizzle-orm/pg-core/array"],
]);

/**
 * Disallow Drizzle APIs removed or relocated in the 1.0 line.
 *
 * The `_query` accessor is Relational Queries v1, removed on Postgres in 1.0.0-rc.1 and on
 * MySQL in rc.3. The instance-level `casing` option moved onto tables, views and schemas, and
 * leaving it on the `drizzle()` call means drizzle-orm and drizzle-kit can disagree about
 * column names — which shows up as a spurious migration rather than an error.
 */
export const noDrizzleLegacyApiRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow Drizzle APIs removed or relocated in the 1.0 line: the RQBv1 `_query` accessor, the instance-level `casing` option, and moved `pg-core` subpaths.",
		},
		messages: {
			relationalQueriesV1:
				"`_query` is Relational Queries v1, removed in the Drizzle 1.0 line. Use `db.query` with relations declared via `defineRelations`.",
			instanceCasing:
				"The instance-level `casing` option moved onto tables/views/schemas in Drizzle 1.0. Leaving it here lets drizzle-orm and drizzle-kit disagree about column names.",
			movedPath: "`{{from}}` moved in Drizzle 1.0. Import from `{{to}}`.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		let importsDrizzle = false;

		return {
			Program(node) {
				bindings = collectImportBindings(node);
				importsDrizzle = importsAnyModule(bindings, DRIZZLE_MODULES);
			},
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				const target = MOVED_PATHS.get(node.source.value);
				if (target === undefined) return;
				context.report({
					node: node.source,
					messageId: "movedPath",
					data: { from: node.source.value, to: target },
					fix: (fixer: Fixer) => fixer.replaceText(node.source, JSON.stringify(target)),
				});
			},
			MemberExpression(node: ESTree.MemberExpression) {
				if (!importsDrizzle) return;
				if (staticMemberName(node) !== "_query") return;
				context.report({ node, messageId: "relationalQueriesV1" });
			},
			CallExpression(node: ESTree.CallExpression) {
				if (!isModuleExport(node.callee, bindings, DRIZZLE_MODULES, "drizzle")) return;
				for (const argument of node.arguments) {
					if (argument.type === "SpreadElement") continue;
					const options = unwrapExpression(argument);
					if (options.type !== "ObjectExpression") continue;
					for (const property of options.properties) {
						if (propertyKeyName(property) !== "casing" || property.type !== "Property") continue;
						context.report({ node: property.key, messageId: "instanceCasing" });
					}
				}
			},
		};
	},
});
