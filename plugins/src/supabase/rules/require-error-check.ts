import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	isModuleExport,
	memberChainRoot,
	propertyKeyName,
	unwrapExpression,
} from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const SUPABASE_MODULES = ["@supabase/ssr", "@supabase/supabase-js", "@supabase/server"] as const;

/** Factories whose return value is a Supabase client. */
const CLIENT_FACTORIES = ["createBrowserClient", "createClient", "createServerClient"] as const;

/** Query entrypoints that resolve to a `{ data, error }` envelope. */
const QUERY_ENTRYPOINTS = new Set(["from", "rpc", "schema", "storage"]);

/** `true` when the chain contains a call to a PostgREST/storage entrypoint. */
function touchesQueryEntrypoint(node: ESTree.Expression): boolean {
	let current = unwrapExpression(node);
	for (;;) {
		if (current.type === "MemberExpression") {
			const name = current.computed ? null : current.property.name;
			if (name !== null && QUERY_ENTRYPOINTS.has(name)) return true;
			current = unwrapExpression(current.object);
			continue;
		}
		if (current.type === "CallExpression") {
			current = unwrapExpression(current.callee);
			continue;
		}
		return false;
	}
}

/**
 * Require the `error` field when destructuring a Supabase response.
 *
 * Supabase never throws on a failed query — it resolves with `{ data: null, error }`.
 * Destructuring only `data` therefore turns every failure into a silent `null`, which flows on
 * as "no rows" and is indistinguishable from an empty result. RLS denials in particular look
 * exactly like an empty table.
 */
export const requireErrorCheckRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require destructuring `error` alongside `data` from a Supabase query, which resolves with an error envelope rather than throwing.",
		},
		messages: {
			missingErrorBinding:
				"Supabase resolves failures as `{ data: null, error }` rather than throwing, so this drops the error and `data` becomes an indistinguishable `null` — an RLS denial looks the same as an empty table. Destructure `error` and check it.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		/** Locals holding a Supabase client. */
		let clientNames = new Set<string>();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
				clientNames = new Set();
			},
			VariableDeclarator(node: ESTree.VariableDeclarator) {
				if (node.init === null) return;

				// `const supabase = await createServerClient(...)` — record the client binding.
				// Declarations precede their uses in source order, so a single pass suffices.
				if (node.id.type === "Identifier") {
					const init = unwrapExpression(node.init);
					const call = init.type === "AwaitExpression" ? unwrapExpression(init.argument) : init;
					if (call.type !== "CallExpression") return;
					const isClient = CLIENT_FACTORIES.some((factory) =>
						isModuleExport(call.callee, bindings, SUPABASE_MODULES, factory),
					);
					if (isClient) clientNames.add(node.id.name);
					return;
				}

				if (node.id.type !== "ObjectPattern") return;
				const init = unwrapExpression(node.init);
				if (init.type !== "AwaitExpression") return;
				const awaited = unwrapExpression(init.argument);

				// Only report chains that demonstrably start at a tracked Supabase client and pass
				// through a query entrypoint, so unrelated `{ data }` destructuring is untouched.
				const root = memberChainRoot(awaited);
				if (root === null || !clientNames.has(root.name)) return;
				if (!touchesQueryEntrypoint(awaited)) return;

				const keys = new Set(node.id.properties.map((property) => propertyKeyName(property)));
				if (keys.has("error")) return;
				// A rest element captures `error` too.
				if (node.id.properties.some((property) => property.type === "RestElement")) return;
				if (!keys.has("data")) return;
				context.report({ node: node.id, messageId: "missingErrorBinding" });
			},
		};
	},
});
