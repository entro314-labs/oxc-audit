import { RuleTester } from "oxlint/plugins-dev";

import { noZodSafeParseJsonParseRule } from "./no-zod-safe-parse-json-parse.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const zod = 'import { z } from "zod";';
const error = { messageId: "throwsBeforeParse" };

if (noZodSafeParseJsonParseRule.meta?.fixable !== undefined) {
	throw new Error("The fix needs an error-handling decision; the rule must not fix.");
}

tester.run("data-layer/no-zod-safe-parse-json-parse", noZodSafeParseJsonParseRule, {
	valid: [
		// Decoded first, so a SyntaxError is handled where it happens.
		`${zod} const decoded = JSON.parse(text); const result = schema.safeParse(decoded);`,
		`${zod} const result = schema.safeParse(payload);`,
		// `.parse()` makes no promise not to throw, so nothing is being contradicted.
		`${zod} const value = schema.parse(JSON.parse(text));`,
		// A different `parse` behind the same shape.
		`${zod} const result = schema.safeParse(yaml.parse(text));`,
		// No Zod import: some other library's `safeParse`.
		"const result = schema.safeParse(JSON.parse(text));",
	],
	invalid: [
		{
			name: "JSON.parse inside safeParse",
			code: `${zod} const result = schema.safeParse(JSON.parse(text));`,
			errors: [error],
		},
		{
			name: "JSON.parse inside safeParseAsync",
			code: `${zod} const result = await schema.safeParseAsync(JSON.parse(text));`,
			errors: [error],
		},
		{
			name: "with a reviver argument",
			code: `${zod} const result = schema.safeParse(JSON.parse(text, reviver));`,
			errors: [error],
		},
		{
			name: "parenthesised",
			code: `${zod} const result = schema.safeParse((JSON.parse(text)));`,
			errors: [error],
		},
	],
});
