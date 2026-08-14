import { RuleTester } from "oxlint/plugins-dev";

import { noZodStringFormatMethodsRule } from "./no-zod-string-format-methods.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { z } from "zod";\n';

tester.run("data-layer/no-zod-string-format-methods", noZodStringFormatMethodsRule, {
	valid: [
		`${IMPORT}const schema = z.email();`,
		`${IMPORT}const schema = z.iso.datetime();`,
		`${IMPORT}const schema = z.string().min(1);`,
		`${IMPORT}const schema = z.string().regex(/x/);`,
		// `email` here is a project-local builder, not a Zod schema.
		'const s = { string: () => ({ email: () => 1 }) };\nconst schema = s.string().email();',
		// Type-only imports never appear in value position.
		'import type { z } from "zod";\ndeclare const q: z.ZodString;',
	],
	invalid: [
		{
			name: "top-level format with fix",
			code: `${IMPORT}const schema = z.string().email();`,
			output: `${IMPORT}const schema = z.email();`,
			errors: [{ messageId: "topLevel" }],
		},
		{
			name: "arguments are preserved by the fix",
			code: `${IMPORT}const schema = z.string().uuid({ error: "bad" });`,
			output: `${IMPORT}const schema = z.uuid({ error: "bad" });`,
			errors: [{ messageId: "topLevel" }],
		},
		{
			name: "iso format",
			code: `${IMPORT}const schema = z.string().datetime({ offset: true });`,
			output: `${IMPORT}const schema = z.iso.datetime({ offset: true });`,
			errors: [{ messageId: "iso" }],
		},
		{
			name: "namespace import",
			code: `import * as zod from "zod";\nconst schema = zod.string().url();`,
			output: `import * as zod from "zod";\nconst schema = zod.url();`,
			errors: [{ messageId: "topLevel" }],
		},
		{
			name: "intermediate check makes the rewrite unsafe, so no fix is offered",
			code: `${IMPORT}const schema = z.string().min(1).email();`,
			errors: [{ messageId: "topLevel" }],
		},
		{
			name: "named import has no namespace to rewrite through",
			code: `import { string } from "zod";\nconst schema = string().email();`,
			errors: [{ messageId: "topLevel" }],
		},
		{
			name: "ip has no single replacement",
			code: `${IMPORT}const schema = z.string().ip();`,
			errors: [{ messageId: "versioned" }],
		},
	],
});
