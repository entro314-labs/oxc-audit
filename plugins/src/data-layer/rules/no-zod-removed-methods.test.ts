import { RuleTester } from "oxlint/plugins-dev";

import { noZodRemovedMethodsRule } from "./no-zod-removed-methods.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { z } from "zod";\n';

tester.run("data-layer/no-zod-removed-methods", noZodRemovedMethodsRule, {
	valid: [
		`${IMPORT}const s = z.object({}).extend({ a: z.string() });`,
		`${IMPORT}const s = z.object({}).loose();`,
		`${IMPORT}const s = z.enum(["a", "b"]);`,
		// A non-Zod `.merge()` in a Zod-importing file stays untouched: the chain does not start at `z`.
		`${IMPORT}const merged = lodash.merge(a, b);`,
		// No Zod import at all.
		"const s = schema.passthrough();",
	],
	invalid: [
		{
			name: "removed method on a z-rooted chain",
			code: `${IMPORT}const s = z.object({}).passthrough();`,
			errors: [{ messageId: "removed" }],
		},
		{
			name: "strip is removed",
			code: `${IMPORT}const s = z.object({}).strip();`,
			errors: [{ messageId: "removed" }],
		},
		{
			name: "deepPartial is Zod-unique, so an untraceable receiver still reports",
			code: `${IMPORT}const s = UserSchema.deepPartial();`,
			errors: [{ messageId: "removed" }],
		},
		{
			name: "nativeEnum is Zod-unique",
			code: `${IMPORT}const s = z.nativeEnum(Role);`,
			errors: [{ messageId: "removed" }],
		},
		{
			name: "merge is discouraged rather than removed",
			code: `${IMPORT}const s = z.object({}).merge(other);`,
			errors: [{ messageId: "discouraged" }],
		},
	],
});
