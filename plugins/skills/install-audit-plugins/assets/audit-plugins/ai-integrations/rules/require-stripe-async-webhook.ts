import { defineRule } from "@oxlint/plugins";

import { staticMemberName } from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";

/** Synchronous verification helpers and their Web Crypto counterparts. */
const SYNC_HELPERS = new Map<string, string>([
	["constructEvent", "constructEventAsync"],
	["parseEventNotification", "parseEventNotificationAsync"],
]);

/** `webhooks.constructEvent(...)` — the only receiver this rule accepts. */
const WEBHOOK_RECEIVERS = new Set(["webhooks"]);

/**
 * Require the async Stripe webhook verification helpers.
 *
 * The synchronous variants use Node's crypto module, which does not exist on Workers or any
 * other edge runtime — so verification throws there rather than failing closed. The async
 * variants use Web Crypto and work in both.
 */
export const requireStripeAsyncWebhookRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Require `constructEventAsync` / `parseEventNotificationAsync`, since the synchronous variants depend on Node crypto and throw on edge runtimes.",
		},
		messages: {
			syncHelper:
				"`{{name}}` uses Node crypto and throws on edge/Workers runtimes. Use `await stripe.webhooks.{{replacement}}(rawBody, signature, secret)`.",
		},
	},
	createOnce(context) {
		return {
			CallExpression(node: ESTree.CallExpression) {
				const { callee } = node;
				if (callee.type !== "MemberExpression") return;
				const name = staticMemberName(callee);
				if (name === null) return;
				const replacement = SYNC_HELPERS.get(name);
				if (replacement === undefined) return;
				// Anchor on the `webhooks` namespace so unrelated `constructEvent` helpers are ignored.
				const receiver = callee.object;
				if (receiver.type !== "MemberExpression") return;
				const receiverName = staticMemberName(receiver);
				if (receiverName === null || !WEBHOOK_RECEIVERS.has(receiverName)) return;
				context.report({
					node: callee.property,
					messageId: "syncHelper",
					data: { name, replacement },
					// Swapping in the async helper without an `await` would turn a verified event
					// into an unhandled Promise, so only an already-awaited call is rewritten.
					fix:
						node.parent.type === "AwaitExpression"
							? (fixer: Fixer) => fixer.replaceText(callee.property, replacement)
							: undefined,
				});
			},
		};
	},
});
