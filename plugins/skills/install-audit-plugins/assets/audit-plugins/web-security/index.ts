import { definePlugin } from "@oxlint/plugins";

import { noHardcodedCredentialRule } from "./rules/no-hardcoded-credential.ts";
import { noInsecureRandomnessRule } from "./rules/no-insecure-randomness.ts";
import { noShellInjectionRule } from "./rules/no-shell-injection.ts";
import { requireSanitizedHtmlRule } from "./rules/require-sanitized-html.ts";

/**
 * Stack-agnostic OWASP Top 10:2025 checks, applicable to any JavaScript or TypeScript project.
 *
 * Scoped to what has no oxlint built-in: `no-eval`, `no-new-func`, `no-implied-eval`,
 * `no-script-url` and `unicorn/require-post-message-target-origin` already cover the injection
 * primitives, and the shipped preset enables them alongside these.
 */
const webSecurityPlugin = definePlugin({
	meta: { name: "web-security" },
	rules: {
		"no-hardcoded-credential": noHardcodedCredentialRule,
		"no-insecure-randomness": noInsecureRandomnessRule,
		"no-shell-injection": noShellInjectionRule,
		"require-sanitized-html": requireSanitizedHtmlRule,
	},
});

export default webSecurityPlugin;
