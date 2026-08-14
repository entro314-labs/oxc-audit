import { RuleTester } from "oxlint/plugins-dev";

import { noZodLegacyErrorParamsRule } from "./no-zod-legacy-error-params.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { z } from "zod";\n';

tester.run("data-layer/no-zod-legacy-error-params", noZodLegacyErrorParamsRule, {
	valid: [
		`${IMPORT}const s = z.string({ error: "required" });`,
		`${IMPORT}const s = z.string({ error: (issue) => (issue.code === "too_small" ? "short" : undefined) });`,
		// No Zod import: these keys belong to something else entirely.
		'const options = { required_error: "x", errorMap: () => 1 };',
	],
	invalid: [
		{
			name: "required_error is renamed",
			code: `${IMPORT}const s = z.string({ required_error: "required" });`,
			output: `${IMPORT}const s = z.string({ error: "required" });`,
			errors: [{ messageId: "legacyKey" }],
		},
		{
			name: "invalid_type_error is renamed",
			code: `${IMPORT}const s = z.number({ invalid_type_error: "nope" });`,
			output: `${IMPORT}const s = z.number({ error: "nope" });`,
			errors: [{ messageId: "legacyKey" }],
		},
		{
			name: "errorMap takes a different callback shape, so it is reported without a fix",
			code: `${IMPORT}const s = z.string({ errorMap: () => ({ message: "x" }) });`,
			errors: [{ messageId: "legacyKey" }],
		},
		{
			name: "a non-literal value cannot be renamed blindly",
			code: `${IMPORT}const s = z.string({ required_error: buildMessage() });`,
			errors: [{ messageId: "legacyKey" }],
		},
	],
});
