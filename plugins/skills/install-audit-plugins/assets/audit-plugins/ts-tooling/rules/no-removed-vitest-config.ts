import { defineRule } from "@oxlint/plugins";

import { propertyKeyName, unwrapExpression } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

/** Vitest 3 config keys removed in Vitest 4. */
const REMOVED_KEYS = new Map<string, string>([
	["environmentMatchGlobs", "`test.projects`"],
	["minWorkers", "nothing — it is auto-set to 0 in non-watch mode; drop the option"],
	["poolMatchGlobs", "`test.projects`"],
	["workspace", "`test.projects`"],
]);

/** Vite 8 renamed the dev-server HMR options block. */
const RENAMED_KEYS = new Map<string, string>([["hmr", "ws"]]);

/** Config files this rule applies to. Application code is never inspected. */
const CONFIG_FILE = /(^|[\\/])(vite|vitest)\.config(\.[a-z]+)?\.[cm]?[jt]s$/;

/**
 * Object keys whose values hold the renamed blocks, so `server.hmr` is caught but a stray
 * `hmr` elsewhere is not.
 */
const RENAME_PARENTS = new Map<string, string>([["hmr", "server"]]);

/** The key of the object property this object literal is the value of, if any. */
function enclosingKey(node: ESTree.ObjectExpression): string | null {
	const { parent } = node;
	return parent.type === "Property" ? propertyKeyName(parent) : null;
}

/**
 * Disallow Vitest 3 and Vite 7 config keys removed or renamed in Vitest 4 / Vite 8.
 *
 * Vite does not reject unknown config keys, so a surviving `workspace` or `server.hmr` block
 * reads as configuration while contributing nothing — projects silently collapse to a single
 * default project, or lose their HMR tuning.
 */
export const noRemovedVitestConfigRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow Vitest 3 config keys removed in Vitest 4 (`workspace`, `minWorkers`, `environmentMatchGlobs`, `poolMatchGlobs`) and the Vite 8 `server.hmr` rename.",
		},
		messages: {
			removedKey: "`{{key}}` was removed in Vitest 4 and is ignored. Use {{replacement}}.",
			renamedKey: "`{{key}}` was renamed in Vite 8 and is ignored. Use `{{replacement}}`.",
		},
	},
	createOnce(context) {
		let inConfigFile = false;

		return {
			Program() {
				inConfigFile = CONFIG_FILE.test(context.filename);
			},
			ObjectExpression(node: ESTree.ObjectExpression) {
				if (!inConfigFile) return;
				const parentKey = enclosingKey(node);
				for (const property of node.properties) {
					const key = propertyKeyName(property);
					if (key === null || property.type !== "Property") continue;

					const removed = REMOVED_KEYS.get(key);
					if (removed !== undefined) {
						context.report({
							node: property.key,
							messageId: "removedKey",
							data: { key, replacement: removed },
						});
						continue;
					}

					const renamed = RENAMED_KEYS.get(key);
					if (renamed === undefined || RENAME_PARENTS.get(key) !== parentKey) continue;
					// A boolean `server.hmr: false` is still the documented way to disable HMR.
					if (unwrapExpression(property.value).type === "Literal") continue;
					context.report({
						node: property.key,
						messageId: "renamedKey",
						data: { key, replacement: renamed },
					});
				}
			},
		};
	},
});
