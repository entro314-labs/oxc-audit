import { RuleTester } from "oxlint/plugins-dev";

import { noGetSessionForAuthorizationRule } from "./no-get-session-for-authorization.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { createServerClient } from "@supabase/ssr";\n';

tester.run("supabase/no-get-session-for-authorization", noGetSessionForAuthorizationRule, {
	valid: [
		`${IMPORT}async function f() { const { data } = await supabase.auth.getUser(); }`,
		// Client components may read session state; the browser is already untrusted.
		`"use client";\n${IMPORT}async function f() { const s = await supabase.auth.getSession(); }`,
		// Not the Supabase auth namespace.
		`${IMPORT}async function f() { const s = await store.getSession(); }`,
		// No Supabase import at all.
		"async function f() { const s = await client.auth.getSession(); }",
	],
	invalid: [
		{
			name: "server-side session read",
			code: `${IMPORT}async function f() { const { data } = await supabase.auth.getSession(); }`,
			errors: [{ messageId: "unvalidatedSession" }],
		},
		{
			name: "used to gate access",
			code: `${IMPORT}async function guard() { const s = await supabase.auth.getSession(); if (!s.data.session) throw new Error("no"); }`,
			errors: [{ messageId: "unvalidatedSession" }],
		},
	],
});
