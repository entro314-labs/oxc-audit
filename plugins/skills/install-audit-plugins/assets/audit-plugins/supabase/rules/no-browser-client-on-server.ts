import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, hasDirective, isModuleExport } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const SSR_MODULES = ["@supabase/ssr"] as const;

/**
 * Disallow `createBrowserClient` in modules that are not client components.
 *
 * The browser client reads and writes `document.cookie`. Rendered on the server there is no
 * `document`, so it either throws or — worse, when a bundler shims it — silently shares one
 * process-wide session across every request. `createServerClient` with an explicit
 * `getAll`/`setAll` cookie adapter is the server-side equivalent.
 */
export const noBrowserClientOnServerRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				'Disallow `createBrowserClient` in modules without a `"use client"` directive, where it has no `document.cookie` to read.',
		},
		messages: {
			browserClientOnServer:
				'`createBrowserClient` depends on `document.cookie`, which does not exist on the server. Use `createServerClient` with a cookie adapter, or add a `"use client"` directive if this module really is client-only.',
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		let isClientModule = false;

		return {
			Program(node: ESTree.Program) {
				bindings = collectImportBindings(node);
				isClientModule = hasDirective(node, "use client");
			},
			CallExpression(node: ESTree.CallExpression) {
				if (isClientModule) return;
				if (!isModuleExport(node.callee, bindings, SSR_MODULES, "createBrowserClient")) return;
				context.report({ node, messageId: "browserClientOnServer" });
			},
		};
	},
});
