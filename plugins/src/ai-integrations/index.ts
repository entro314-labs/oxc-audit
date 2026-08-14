import { definePlugin } from "@oxlint/plugins";

import { noAiV6ExportsRule } from "./rules/no-ai-v6-exports.ts";
import { noAiV6OptionsRule } from "./rules/no-ai-v6-options.ts";
import { noAiV6ResultMembersRule } from "./rules/no-ai-v6-result-members.ts";
import { noStripeUnverifiedWebhookRule } from "./rules/no-stripe-unverified-webhook.ts";
import { noStripeV21ApiRule } from "./rules/no-stripe-v21-api.ts";
import { requireStripeAsyncWebhookRule } from "./rules/require-stripe-async-webhook.ts";

/**
 * Vercel AI SDK v6 -> v7 migration residue and Stripe webhook footguns.
 *
 * The AI SDK rules mostly catch options v7 ignores rather than rejects; the Stripe webhook
 * rules cover the two ways a verification step stops verifying — skipped by design, or thrown
 * away by an edge runtime that has no Node crypto.
 */
const aiIntegrationsPlugin = definePlugin({
	meta: { name: "ai-integrations" },
	rules: {
		"no-ai-v6-exports": noAiV6ExportsRule,
		"no-ai-v6-options": noAiV6OptionsRule,
		"no-ai-v6-result-members": noAiV6ResultMembersRule,
		"no-stripe-unverified-webhook": noStripeUnverifiedWebhookRule,
		"no-stripe-v21-api": noStripeV21ApiRule,
		"require-stripe-async-webhook": requireStripeAsyncWebhookRule,
	},
});

export default aiIntegrationsPlugin;
