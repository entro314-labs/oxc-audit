import { RuleTester } from "oxlint/plugins-dev";

import { noChainedTypeAssertionsRule } from "./no-chained-type-assertions.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "chained" };

if (noChainedTypeAssertionsRule.meta?.fixable !== undefined) {
	throw new Error("Removing an assertion chain changes what type-checks; the rule must not fix.");
}

tester.run("slop-stop/no-chained-type-assertions", noChainedTypeAssertionsRule, {
	valid: [
		// A single assertion is this rule's floor; `require-safety-comment-for-type-assertion`
		// is what asks for its justification.
		"const user = payload as User;",
		"const user = <User>payload;",
		"const mode = 'strict' as const;",
		// Const-only chains re-narrow rather than launder, so they carry no lost evidence.
		"const mode = { level: 1 } as const as const;",
		// Sibling assertions in one expression are not a chain.
		"const pair = [a as User, b as Account];",
		"const name = (user as User).name as string;",
	],
	invalid: [
		{
			name: "laundering through unknown",
			code: "const user = payload as unknown as User;",
			errors: [error],
		},
		{
			name: "laundering through any",
			code: "const user = payload as any as User;",
			errors: [error],
		},
		{
			name: "angle-bracket chain",
			code: "const user = <User>(<unknown>payload);",
			errors: [error],
		},
		{
			name: "parentheses do not break the chain",
			code: "const user = ((payload as unknown)) as User;",
			errors: [error],
		},
		{
			name: "mixed assertion syntaxes",
			code: "const user = <User>(payload as unknown);",
			errors: [error],
		},
		{
			name: "a const assertion in the chain does not excuse the widening step",
			code: "const user = ({ id } as const) as unknown as User;",
			errors: [error],
		},
		{
			// Reported once, at the outermost assertion, rather than once per link.
			name: "three links report a single finding",
			code: "const user = payload as unknown as Record<string, unknown> as User;",
			errors: [error],
		},
	],
});
