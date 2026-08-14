import { RuleTester } from "oxlint/plugins-dev";

import { noZodShapeSpreadDropsRefinementsRule } from "./no-zod-shape-spread-drops-refinements.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const zod = 'import { z } from "zod";';
const error = { messageId: "dropsRefinements" };

if (noZodShapeSpreadDropsRefinementsRule.meta?.fixable !== undefined) {
	throw new Error("Switching a spread to `.extend()` changes the schema; the rule must not fix.");
}

tester.run(
	"data-layer/no-zod-shape-spread-drops-refinements",
	noZodShapeSpreadDropsRefinementsRule,
	{
		valid: [
			// The replacement this rule asks for.
			`${zod} const base = z.object({ a: z.string() }).refine(ok); const next = base.extend({ b: z.string() });`,
			// An unrefined base carries no checks to lose.
			`${zod} const base = z.object({ a: z.string() }); const next = z.object({ ...base.shape, b: z.string() });`,
			// `.shape` spread outside a Zod object constructor is a plain object build.
			`${zod} const base = z.object({ a: z.string() }).refine(ok); const keys = { ...base.shape };`,
			// A base this file never declared is not guessed at.
			`${zod} import { base } from "./base"; const next = z.object({ ...base.shape });`,
			// Not a `.shape` spread.
			`${zod} const base = z.object({ a: z.string() }).refine(ok); const next = z.object({ ...other });`,
			// No Zod import, so `z` is something else entirely.
			"const base = z.object({ a: 1 }).refine(ok); const next = z.object({ ...base.shape });",
		],
		invalid: [
			{
				name: "refine dropped by a rebuild",
				code: `${zod} const base = z.object({ a: z.string() }).refine(ok); const next = z.object({ ...base.shape, b: z.string() });`,
				errors: [error],
			},
			{
				name: "superRefine dropped by a rebuild",
				code: `${zod} const base = z.object({ a: z.string() }).superRefine(ok); const next = z.strictObject({ ...base.shape });`,
				errors: [error],
			},
			{
				name: "check dropped by a rebuild",
				code: `${zod} const base = z.object({ a: z.string() }).check(ok); const next = z.looseObject({ ...base.shape });`,
				errors: [error],
			},
			{
				name: "refinement behind further chain links",
				code: `${zod} const base = z.object({ a: z.string() }).refine(ok).describe("x"); const next = z.object({ ...base.shape });`,
				errors: [error],
			},
			{
				name: "namespace import",
				code: `import * as zod from "zod"; const base = zod.object({ a: zod.string() }).refine(ok); const next = zod.object({ ...base.shape });`,
				errors: [error],
			},
		],
	},
);
