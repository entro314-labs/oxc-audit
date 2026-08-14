import { RuleTester } from "oxlint/plugins-dev";

import { noStripeUnverifiedWebhookRule } from "./no-stripe-unverified-webhook.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("ai-integrations/no-stripe-unverified-webhook", noStripeUnverifiedWebhookRule, {
	valid: [
		"const event = await stripe.webhooks.constructEventAsync(body, sig, secret);",
		"const event = await stripe.parseEventNotificationAsync(body, sig, secret);",
	],
	invalid: [
		{
			code: "const event = stripe.webhooks.constructEventWithoutVerification(body);",
			errors: [{ messageId: "unverified" }],
		},
		{
			code: "const event = stripe.parseEventNotificationWithoutVerification(body);",
			errors: [{ messageId: "unverified" }],
		},
	],
});
