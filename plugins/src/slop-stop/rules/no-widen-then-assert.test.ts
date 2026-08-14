import { RuleTester } from "oxlint/plugins-dev";

import { noWidenThenAssertRule } from "./no-widen-then-assert.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "widenThenAssert" };

if (noWidenThenAssertRule.meta?.fixable !== undefined) {
	throw new Error("Dropping the widening step changes inference; the rule must not fix.");
}

tester.run("slop-stop/no-widen-then-assert", noWidenThenAssertRule, {
	valid: [
		"const user: User = { id: 1 };",
		// The legitimate shape: the value genuinely arrives untyped, so the assertion adds
		// information rather than recreating information that was thrown away.
		"const raw: unknown = JSON.parse(text); const user = raw as User;",
		"const raw: unknown = await response.json(); const user = raw as User;",
		// A mutable binding has no single known value to preserve.
		"let raw: unknown = { id: 1 }; raw = other; const user = raw as User;",
		// Widening to one broad type and asserting to another is not a round trip.
		"const raw: unknown = { id: 1 }; const other = raw as unknown;",
		// The assertion crosses a function boundary, so the two are not one local flow.
		"const raw: unknown = { id: 1 }; function use() { return raw as User; }",
		// The assertion precedes the widening declaration.
		"const user = raw as User; const raw: unknown = { id: 1 };",
		// `Record<string, string>` is not a broad dictionary; its values are typed.
		"const raw: Record<string, string> = { id: 'a' }; const user = raw as User;",
	],
	invalid: [
		{
			name: "declared unknown, asserted back",
			code: "const raw: unknown = { id: 1 }; const user = raw as User;",
			errors: [error],
		},
		{
			name: "declared any, asserted back",
			code: "const raw: any = { id: 1 }; const user = raw as User;",
			errors: [error],
		},
		{
			name: "widened by an assertion on the initializer",
			code: "const raw = { id: 1 } as unknown; const user = raw as User;",
			errors: [error],
		},
		{
			name: "object keyword widening",
			code: "const raw: object = { id: 1 }; const user = raw as { id: number };",
			errors: [error],
		},
		{
			name: "open dictionary widening",
			code: "const raw: Record<string, unknown> = { id: 1 }; const user = raw as { id: number };",
			errors: [error],
		},
		{
			name: "index-signature widening",
			code: "const raw: { [key: string]: unknown } = { id: 1 }; const user = raw as { id: number };",
			errors: [error],
		},
		{
			name: "evidence reached through an intermediate const",
			code: "const base = { id: 1 }; const raw: unknown = base; const user = raw as User;",
			errors: [error],
		},
		{
			name: "array literal evidence",
			code: "const raw: unknown = [1, 2]; const user = raw as number[];",
			errors: [error],
		},
		{
			name: "the same flow inside a function body",
			code: "function load() { const raw: unknown = { id: 1 }; return raw as User; }",
			errors: [error],
		},
	],
});
