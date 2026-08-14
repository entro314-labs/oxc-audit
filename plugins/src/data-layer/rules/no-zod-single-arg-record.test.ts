import { RuleTester } from "oxlint/plugins-dev";

import { noZodSingleArgRecordRule } from "./no-zod-single-arg-record.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { z } from "zod";\n';

tester.run("data-layer/no-zod-single-arg-record", noZodSingleArgRecordRule, {
	valid: [
		`${IMPORT}const s = z.record(z.string(), z.number());`,
		`${IMPORT}const s = z.record(z.enum(["a"]), z.number());`,
		"const s = db.record(value);",
	],
	invalid: [
		{
			name: "single argument gains an explicit key schema",
			code: `${IMPORT}const s = z.record(z.number());`,
			output: `${IMPORT}const s = z.record(z.string(), z.number());`,
			errors: [{ messageId: "singleArgument" }],
		},
		{
			name: "named import has no namespace to build the key schema from",
			code: 'import { record, number } from "zod";\nconst s = record(number());',
			errors: [{ messageId: "singleArgument" }],
		},
	],
});
