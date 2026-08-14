import { RuleTester } from "oxlint/plugins-dev";

import { requireErrorCheckRule } from "./require-error-check.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const SETUP = 'import { createClient } from "@supabase/supabase-js";\nconst supabase = createClient(url, key);\n';

tester.run("supabase/require-error-check", requireErrorCheckRule, {
	valid: [
		`${SETUP}async function f() { const { data, error } = await supabase.from("users").select(); }`,
		`${SETUP}async function f() { const { data, ...rest } = await supabase.from("users").select(); }`,
		`${SETUP}async function f() { const result = await supabase.from("users").select(); }`,
		`${SETUP}async function f() { const { error } = await supabase.from("users").insert(row); }`,
		// Not a Supabase client.
		'async function f() { const { data } = await axios.get("/users"); }',
		// A tracked client, but not a query chain.
		`${SETUP}async function f() { const { data } = await supabase.auth.getUser(); }`,
	],
	invalid: [
		{
			name: "select drops the error",
			code: `${SETUP}async function f() { const { data } = await supabase.from("users").select(); }`,
			errors: [{ messageId: "missingErrorBinding" }],
		},
		{
			name: "rpc drops the error",
			code: `${SETUP}async function f() { const { data } = await supabase.rpc("total", {}); }`,
			errors: [{ messageId: "missingErrorBinding" }],
		},
		{
			name: "storage drops the error",
			code: `${SETUP}async function f() { const { data } = await supabase.storage.from("b").upload(p, f); }`,
			errors: [{ messageId: "missingErrorBinding" }],
		},
	],
});
