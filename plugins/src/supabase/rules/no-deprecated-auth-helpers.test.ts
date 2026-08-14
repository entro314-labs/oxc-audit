import { RuleTester } from "oxlint/plugins-dev";

import { noDeprecatedAuthHelpersRule } from "./no-deprecated-auth-helpers.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("supabase/no-deprecated-auth-helpers", noDeprecatedAuthHelpersRule, {
	valid: [
		'import { createServerClient, createBrowserClient } from "@supabase/ssr";',
		'import { createClient } from "@supabase/supabase-js";',
		'import { createRouteHandlerClient } from "./my-own-helpers";',
	],
	invalid: [
		{
			code: 'import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";',
			errors: [{ messageId: "deprecatedPackage" }],
		},
		{
			code: 'import { useUser } from "@supabase/auth-helpers-react";',
			errors: [{ messageId: "deprecatedPackage" }],
		},
		{
			name: "factory re-exported from a current package",
			code: 'import { createRouteHandlerClient } from "@supabase/ssr";',
			errors: [{ messageId: "replacedFactory" }],
		},
	],
});
