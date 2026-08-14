import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	hasDirective,
	importsAnyModule,
	staticMemberName,
} from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

const SUPABASE_MODULES = ["@supabase/supabase-js", "@supabase/ssr", "@supabase/server"] as const;

/**
 * Disallow `getSession()` on the server, where its result cannot be trusted.
 *
 * `getSession()` reads the session straight out of the cookie and returns it without asking
 * the auth server whether it is real. On the client that is fine — the client is already
 * untrusted, and the cookie is the browser's own. On the server it is an authorization hole:
 * anyone who can forge the cookie gets whatever the session grants. `getUser()` validates the
 * JWT against the auth server and is the only safe basis for a server-side access decision.
 *
 * Scoped to modules without a `"use client"` directive, so genuine client-side reads of
 * non-security session data are left alone.
 */
export const noGetSessionForAuthorizationRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow server-side `getSession()`, which returns unvalidated cookie contents. Use `getUser()` for any authorization decision.",
		},
		messages: {
			unvalidatedSession:
				"`getSession()` returns the cookie without validating it against the auth server, so a forged cookie passes. On the server use `getUser()`, which verifies the JWT. If this module really is client-only, add a `\"use client\"` directive.",
		},
	},
	createOnce(context) {
		let active = false;

		return {
			Program(node: ESTree.Program) {
				const bindings = collectImportBindings(node);
				active =
					importsAnyModule(bindings, SUPABASE_MODULES) && !hasDirective(node, "use client");
			},
			CallExpression(node: ESTree.CallExpression) {
				if (!active) return;
				const { callee } = node;
				if (callee.type !== "MemberExpression") return;
				if (staticMemberName(callee) !== "getSession") return;
				// Anchor on the `auth` namespace so an unrelated `getSession` helper is ignored.
				const receiver = callee.object;
				if (receiver.type !== "MemberExpression" || staticMemberName(receiver) !== "auth") return;
				context.report({ node, messageId: "unvalidatedSession" });
			},
		};
	},
});
