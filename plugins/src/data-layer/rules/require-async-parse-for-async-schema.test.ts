import { RuleTester } from "oxlint/plugins-dev";

import { requireAsyncParseForAsyncSchemaRule } from "./require-async-parse-for-async-schema.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const ASYNC_SCHEMA =
	'import { z } from "zod";\nconst User = z.object({ email: z.email() }).refine(async (v) => isFree(v.email));\n';
const SYNC_SCHEMA =
	'import { z } from "zod";\nconst User = z.object({ email: z.email() }).refine((v) => v.email.length > 3);\n';

tester.run("data-layer/require-async-parse-for-async-schema", requireAsyncParseForAsyncSchemaRule, {
	valid: [
		`${ASYNC_SCHEMA}async function f() { return User.parseAsync(input); }`,
		`${ASYNC_SCHEMA}async function f() { return User.safeParseAsync(input); }`,
		`${SYNC_SCHEMA}function f() { return User.parse(input); }`,
		// Untracked schema: no async check visible in this module.
		'import { User } from "./schema";\nfunction f() { return User.parse(input); }',
	],
	invalid: [
		{
			name: "sync parse on an async schema",
			code: `${ASYNC_SCHEMA}function f() { return User.parse(input); }`,
			errors: [{ messageId: "syncParseOnAsyncSchema" }],
		},
		{
			name: "safeParse is equally sync",
			code: `${ASYNC_SCHEMA}function f() { return User.safeParse(input); }`,
			errors: [{ messageId: "syncParseOnAsyncSchema" }],
		},
		{
			name: "async superRefine",
			code: 'import { z } from "zod";\nconst S = z.string().superRefine(async (v, ctx) => {});\nconst r = S.parse(x);',
			errors: [{ messageId: "syncParseOnAsyncSchema" }],
		},
	],
});
