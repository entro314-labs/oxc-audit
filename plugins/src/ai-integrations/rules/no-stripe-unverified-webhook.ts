import { defineRule } from "@oxlint/plugins";

import { staticMemberName } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

/**
 * Helpers added in stripe-node 22.5.0 that parse an event without checking its signature.
 * They exist for events already verified upstream — at an ingress proxy, or by EventBridge /
 * Event Grid delivery — and for nothing else.
 */
const UNVERIFIED_HELPERS = new Set([
	"constructEventWithoutVerification",
	"parseEventNotificationWithoutVerification",
]);

/**
 * Disallow the Stripe webhook helpers that skip signature verification.
 *
 * On a raw inbound webhook body these accept forged events from anyone who can reach the
 * endpoint: an attacker posts a `checkout.session.completed` and the application grants
 * whatever that event grants. Every call site needs an explicit justification that the event
 * was already verified somewhere upstream.
 */
export const noStripeUnverifiedWebhookRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `constructEventWithoutVerification` / `parseEventNotificationWithoutVerification`, which accept unauthenticated Stripe events.",
		},
		messages: {
			unverified:
				"`{{name}}` skips webhook signature verification, so a forged request is accepted as a real Stripe event. Use `constructEventAsync` unless this event was provably verified upstream (ingress proxy, EventBridge/Event Grid delivery) — and say so in a comment if it was.",
		},
	},
	createOnce(context) {
		return {
			MemberExpression(node: ESTree.MemberExpression) {
				const name = staticMemberName(node);
				if (name === null || !UNVERIFIED_HELPERS.has(name)) return;
				context.report({ node, messageId: "unverified", data: { name } });
			},
		};
	},
});
