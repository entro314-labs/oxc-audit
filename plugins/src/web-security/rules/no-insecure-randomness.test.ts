import { RuleTester } from "oxlint/plugins-dev";

import { noInsecureRandomnessRule } from "./no-insecure-randomness.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("web-security/no-insecure-randomness", noInsecureRandomnessRule, {
	valid: [
		"const token = crypto.randomUUID();",
		"const sessionId = crypto.randomUUID();",
		// Non-security uses are exactly what Math.random is for.
		"const jitter = Math.random() * 1000;",
		"const shuffleSeed = Math.random();",
		"const index = Math.floor(Math.random() * items.length);",
		// Not the global Math.
		"const token = fakeMath.random();",
	],
	invalid: [
		{
			name: "token from a variable name",
			code: "const token = Math.random().toString(36).slice(2);",
			errors: [{ messageId: "insecureRandom" }],
		},
		{
			name: "object property name",
			code: "const payload = { csrfToken: Math.random().toString(16) };",
			errors: [{ messageId: "insecureRandom" }],
		},
		{
			name: "assignment to a member",
			code: "user.sessionId = Math.random().toString(36);",
			errors: [{ messageId: "insecureRandom" }],
		},
		{
			name: "named function returning the value",
			code: "function generateApiKey() { return Math.random().toString(36); }",
			errors: [{ messageId: "insecureRandom" }],
		},
		{
			name: "uuid built from Math.random collides and is predictable",
			code: "const uuid = Math.random().toString(36) + Math.random().toString(36);",
			errors: [{ messageId: "insecureRandom" }, { messageId: "insecureRandom" }],
		},
	],
});
