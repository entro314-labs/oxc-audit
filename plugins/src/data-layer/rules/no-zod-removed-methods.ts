import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	importsAnyModule,
	memberChainRoot,
	resolveValueBinding,
	staticMemberName,
} from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const ZOD_MODULES = ["zod"] as const;

/** Methods Zod 4 removed outright, with the replacement to reach for. */
const REMOVED_METHODS = new Map<string, string>([
	["deepPartial", "an explicit recursive partial schema — `.deepPartial()` was unsound and is gone"],
	["nativeEnum", "`z.enum(...)` over a string-literal union"],
	["passthrough", "`.loose()`"],
	["strip", "`.strict()` / `.loose()` / `.catchall(schema)`, chosen deliberately"],
]);

/** Methods that still exist but changed semantics enough that Zod 4 documents against them. */
const DISCOURAGED_METHODS = new Map<string, string>([
	["merge", "`.extend(other.shape)` — `.merge()` throws on a receiver carrying refinements since 4.4"],
]);

/**
 * Names unique enough to Zod that seeing them anywhere in a Zod-importing file is a finding,
 * even when the receiver is a schema variable this rule cannot trace back to `z`.
 */
const ZOD_UNIQUE = new Set(["deepPartial", "nativeEnum"]);

/**
 * Disallow Zod 3 schema methods that Zod 4 removed or superseded.
 *
 * Receivers are matched two ways: any chain rooted at a `zod` import, plus the handful of
 * method names that exist nowhere else in a typical dependency tree.
 */
export const noZodRemovedMethodsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow Zod 3 schema methods removed or superseded in Zod 4 (`.deepPartial()`, `.nativeEnum()`, `.passthrough()`, `.strip()`, `.merge()`).",
		},
		messages: {
			removed: "`.{{method}}()` was removed in Zod 4. Use {{replacement}}.",
			discouraged: "`.{{method}}()` is discouraged in Zod 4. Use {{replacement}}.",
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
			MemberExpression(node: ESTree.MemberExpression) {
				if (!importsZod) return;
				const method = staticMemberName(node);
				if (method === null) return;
				const removed = REMOVED_METHODS.get(method);
				const discouraged = DISCOURAGED_METHODS.get(method);
				if (removed === undefined && discouraged === undefined) return;

				if (!ZOD_UNIQUE.has(method)) {
					// Only report chains that demonstrably start at a Zod import; `.merge()` and
					// `.strip()` are common enough elsewhere that a looser match would be noise.
					const root = memberChainRoot(node);
					if (root === null || resolveValueBinding(bindings, root.name, ZOD_MODULES) === null) {
						return;
					}
				}

				context.report(
					removed !== undefined
						? { node, messageId: "removed", data: { method, replacement: removed } }
						: {
								node,
								messageId: "discouraged",
								data: { method, replacement: discouraged ?? "" },
							},
				);
			},
		};
	},
});
