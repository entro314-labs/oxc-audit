import { RuleTester } from "oxlint/plugins-dev";

import { noModuleScopeServerClientRule } from "./no-module-scope-server-client.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { createServerClient } from "@supabase/ssr";\n';

tester.run("supabase/no-module-scope-server-client", noModuleScopeServerClientRule, {
	valid: [
		`${IMPORT}export function getClient(cookies) { return createServerClient(url, key, { cookies }); }`,
		`${IMPORT}export const getClient = (cookies) => createServerClient(url, key, { cookies });`,
		`${IMPORT}export async function handler() { const db = createServerClient(url, key, { cookies }); }`,
		// A factory of the same name from elsewhere.
		'import { createServerClient } from "./local";\nconst db = createServerClient();',
	],
	invalid: [
		{
			name: "top-level const",
			code: `${IMPORT}export const db = createServerClient(url, key, { cookies });`,
			errors: [{ messageId: "moduleScopeClient" }],
		},
		{
			name: "top-level inside a block is still module scope",
			code: `${IMPORT}if (flag) { const db = createServerClient(url, key, { cookies }); }`,
			errors: [{ messageId: "moduleScopeClient" }],
		},
	],
});
