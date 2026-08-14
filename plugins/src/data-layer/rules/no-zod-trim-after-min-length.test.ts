import { RuleTester } from "oxlint/plugins-dev";

import { noZodTrimAfterMinLengthRule } from "./no-zod-trim-after-min-length.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const zod = 'import { z } from "zod";';
const error = { messageId: "wrongOrder" };

if (noZodTrimAfterMinLengthRule.meta?.fixable !== undefined) {
	throw new Error("Reordering the chain changes which inputs parse; the rule must not fix.");
}

tester.run("data-layer/no-zod-trim-after-min-length", noZodTrimAfterMinLengthRule, {
	valid: [
		`${zod} const name = z.string().trim().min(1);`,
		`${zod} const name = z.string().min(1);`,
		`${zod} const name = z.string().trim();`,
		// A longer minimum may deliberately measure the untrimmed input.
		`${zod} const name = z.string().min(2).trim();`,
		`${zod} const name = z.string().max(100).trim();`,
		// `.trim()` on something that is not a Zod string schema.
		`${zod} const name = input.min(1).trim();`,
		// No Zod import in the file.
		"const name = z.string().min(1).trim();",
	],
	invalid: [
		{
			name: "min(1) before trim",
			code: `${zod} const name = z.string().min(1).trim();`,
			errors: [error],
		},
		{
			name: "intermediate links between min and trim",
			code: `${zod} const name = z.string().min(1).max(50).trim();`,
			errors: [error],
		},
		{
			name: "named import",
			code: `import { string } from "zod"; const name = string().min(1).trim();`,
			errors: [error],
		},
		{
			name: "namespace import",
			code: `import * as zod from "zod"; const name = zod.string().min(1).trim();`,
			errors: [error],
		},
	],
});
