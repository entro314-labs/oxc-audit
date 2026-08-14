import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, isModuleExport } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const SUPABASE_MODULES = ["@supabase/ssr", "@supabase/supabase-js", "@supabase/server"] as const;

/** Client factories that capture per-request state (cookies, auth headers) when called. */
const REQUEST_SCOPED_FACTORIES = ["createServerClient"] as const;

/** Node types that introduce a new execution scope. */
const FUNCTION_SCOPES = new Set([
	"ArrowFunctionExpression",
	"FunctionDeclaration",
	"FunctionExpression",
]);

/** `true` when nothing between `node` and the Program root introduces a function scope. */
function isAtModuleScope(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null) {
		if (FUNCTION_SCOPES.has(current.type)) return false;
		if (current.type === "Program") return true;
		current = current.parent;
	}
	return false;
}

/**
 * Disallow creating a request-scoped Supabase client at module scope.
 *
 * `createServerClient` closes over the cookie adapter it is given. Called once at module load,
 * that adapter belongs to whichever request happened to load the module first, and every later
 * request reuses it — so one user's session is served to another. The client has to be built
 * inside the handler, per request.
 */
export const noModuleScopeServerClientRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow module-scope `createServerClient`, which pins one request's cookies for the process lifetime and leaks sessions between users.",
		},
		messages: {
			moduleScopeClient:
				"`{{name}}` at module scope captures one request's cookies for the lifetime of the module, so later requests reuse that session. Create the client inside the request handler instead.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				const name = REQUEST_SCOPED_FACTORIES.find((factory) =>
					isModuleExport(node.callee, bindings, SUPABASE_MODULES, factory),
				);
				if (name === undefined || !isAtModuleScope(node)) return;
				context.report({ node, messageId: "moduleScopeClient", data: { name } });
			},
		};
	},
});
