import { defineRule } from "@oxlint/plugins";

import { propertyKeyName } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

interface RemovedKey {
	/** Parent config key this must sit under, or `null` for a top-level key. */
	readonly parent: string | null;
	readonly guidance: string;
}

const REMOVED_KEYS = new Map<string, RemovedKey>([
	[
		"domains",
		{ parent: "images", guidance: "`images.domains` was removed — use `images.remotePatterns`" },
	],
	[
		"ppr",
		{
			parent: "experimental",
			guidance: "the standalone `experimental.ppr` flag consolidated onto `cacheComponents`",
		},
	],
	[
		"useCache",
		{
			parent: "experimental",
			guidance: "`experimental.useCache` is deprecated — use the `'use cache'` directive",
		},
	],
	[
		"publicRuntimeConfig",
		{ parent: null, guidance: "runtime config was removed in Next.js 16 — use build-time env vars" },
	],
	[
		"serverRuntimeConfig",
		{ parent: null, guidance: "runtime config was removed in Next.js 16 — use build-time env vars" },
	],
]);

/** `next.config.js` / `.mjs` / `.ts` / `.mts`, ignoring any directory prefix. */
const CONFIG_FILE = /(^|[\\/])next\.config\.[cm]?[jt]s$/;

/** The key of the object property this object literal is the value of, if any. */
function enclosingKey(node: ESTree.ObjectExpression): string | null {
	const { parent } = node;
	return parent.type === "Property" ? propertyKeyName(parent) : null;
}

/**
 * Disallow Next.js config keys removed or deprecated in the 16 line.
 *
 * Next.js does not fail the build on unknown config keys, so a leftover `publicRuntimeConfig`
 * or `images.domains` reads as configured while doing nothing — the remote-image allow-list in
 * particular silently stops applying.
 */
export const noRemovedNextConfigKeysRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow Next.js config keys removed or deprecated in Next.js 16 (`images.domains`, `publicRuntimeConfig`, `serverRuntimeConfig`, `experimental.ppr`, `experimental.useCache`).",
		},
		messages: {
			removedKey: "`{{key}}` is no longer honoured by Next.js 16: {{guidance}}.",
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
					if (removed === undefined || removed.parent !== parentKey) continue;
					context.report({
						node: property.key,
						messageId: "removedKey",
						data: { key, guidance: removed.guidance },
					});
				}
			},
		};
	},
});
