import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * Credential formats identifiable from their own text, with no naming heuristic involved.
 *
 * Deliberately excludes JSON Web Tokens: a Supabase `anon` key is a JWT and belongs in client
 * code, so `eyJ...` cannot distinguish a published key from a leaked `service_role` one.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
	{ name: "an AWS access key ID", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: "a Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
	{ name: "a GitHub token", pattern: /\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{22,})\b/ },
	{ name: "a Slack token", pattern: /\bxox[abposr]-[0-9A-Za-z-]{10,}/ },
	{ name: "a live Stripe secret key", pattern: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
	{ name: "a Stripe webhook signing secret", pattern: /\bwhsec_[0-9A-Za-z]{20,}\b/ },
	{ name: "a Supabase access token", pattern: /\bsbp_[0-9a-f]{40,}\b/ },
	{ name: "a private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
	{ name: "an npm access token", pattern: /\bnpm_[0-9A-Za-z]{36}\b/ },
];

function findCredential(value: string): string | null {
	for (const { name, pattern } of CREDENTIAL_PATTERNS) {
		if (pattern.test(value)) return name;
	}
	return null;
}

/**
 * Disallow credentials embedded in source.
 *
 * Matching is by credential format alone, so there are no name-based guesses here — every hit
 * is a real key shape. A committed key is compromised even after the commit is amended, since
 * the object stays reachable in the repository and in every clone and fork of it: the finding
 * is a rotation task, not just a refactor.
 */
export const noHardcodedCredentialRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow hardcoded credentials identifiable by their own format (AWS, Google, GitHub, Slack, Stripe, Supabase, npm tokens and private key blocks).",
		},
		messages: {
			hardcodedCredential:
				"This looks like {{name}} committed to source. Move it to an environment variable — and rotate it, because a committed key stays reachable in the repository history and in every clone.",
		},
	},
	createOnce(context) {
		return {
			Literal(node: ESTree.StringLiteral) {
				if (typeof node.value !== "string") return;
				const name = findCredential(node.value);
				if (name === null) return;
				context.report({ node, messageId: "hardcodedCredential", data: { name } });
			},
			TemplateElement(node: ESTree.TemplateElement) {
				const raw = node.value.cooked ?? node.value.raw;
				const name = findCredential(raw);
				if (name === null) return;
				context.report({ node, messageId: "hardcodedCredential", data: { name } });
			},
		};
	},
});
