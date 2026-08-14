import { RuleTester } from "oxlint/plugins-dev";

import { noBrowserClientOnServerRule } from "./no-browser-client-on-server.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { createBrowserClient, createServerClient } from "@supabase/ssr";\n';

tester.run("supabase/no-browser-client-on-server", noBrowserClientOnServerRule, {
	valid: [
		`"use client";\n${IMPORT}export function client() { return createBrowserClient(url, key); }`,
		`${IMPORT}export function server(cookies) { return createServerClient(url, key, { cookies }); }`,
		// A same-named factory from somewhere else.
		'import { createBrowserClient } from "./local";\nconst c = createBrowserClient();',
	],
	invalid: [
		{
			name: "no use client directive",
			code: `${IMPORT}export function client() { return createBrowserClient(url, key); }`,
			errors: [{ messageId: "browserClientOnServer" }],
		},
	],
});
