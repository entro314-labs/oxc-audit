import { RuleTester } from "oxlint/plugins-dev";

import { noStripeV21ApiRule } from "./no-stripe-v21-api.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import Stripe from "stripe";\n';

tester.run("ai-integrations/no-stripe-v21-api", noStripeV21ApiRule, {
	valid: [
		`${IMPORT}const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });`,
		`${IMPORT}declare const ctx: Stripe.StripeContextType;`,
		`${IMPORT}declare const e: Stripe.Event;`,
		// A local factory that happens to share the name.
		'function Stripe(k: string) { return {}; }\nconst s = Stripe(key);',
	],
	invalid: [
		{
			name: "called without new",
			code: `${IMPORT}const stripe = Stripe(key);`,
			errors: [{ messageId: "missingNew" }],
		},
		{
			name: "renamed context type",
			code: `${IMPORT}declare const ctx: Stripe.StripeContext;`,
			errors: [{ messageId: "renamedType" }],
		},
	],
});
