import { RuleTester } from "oxlint/plugins-dev";

import { requireStripeAsyncWebhookRule } from "./require-stripe-async-webhook.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("ai-integrations/require-stripe-async-webhook", requireStripeAsyncWebhookRule, {
	valid: [
		"const event = await stripe.webhooks.constructEventAsync(body, sig, secret);",
		// Not the Stripe webhooks namespace.
		"const event = bus.constructEvent(payload);",
	],
	invalid: [
		{
			name: "already awaited, so the swap is safe",
			code: "const event = await stripe.webhooks.constructEvent(body, sig, secret);",
			output: "const event = await stripe.webhooks.constructEventAsync(body, sig, secret);",
			errors: [{ messageId: "syncHelper" }],
		},
		{
			name: "not awaited — reported without a fix that would leak a Promise",
			code: "const event = stripe.webhooks.constructEvent(body, sig, secret);",
			errors: [{ messageId: "syncHelper" }],
		},
		{
			name: "v2 thin-event notification",
			code: "const n = await stripe.webhooks.parseEventNotification(body, sig, secret);",
			output: "const n = await stripe.webhooks.parseEventNotificationAsync(body, sig, secret);",
			errors: [{ messageId: "syncHelper" }],
		},
	],
});
