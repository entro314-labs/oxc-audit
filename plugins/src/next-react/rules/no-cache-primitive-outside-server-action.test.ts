import { RuleTester } from "oxlint/plugins-dev";

import { noCachePrimitiveOutsideServerActionRule } from "./no-cache-primitive-outside-server-action.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { updateTag, refresh, revalidateTag } from "next/cache";\n';

tester.run(
	"next-react/no-cache-primitive-outside-server-action",
	noCachePrimitiveOutsideServerActionRule,
	{
		valid: [
			{
				name: "module-level use server directive",
				code: `"use server";\n${IMPORT}export async function save() { await db.write(); updateTag("posts"); }`,
			},
			{
				name: "inline use server directive",
				code: `${IMPORT}export async function save() { "use server"; await db.write(); updateTag("posts"); }`,
			},
			{
				name: "revalidateTag works outside an action",
				code: `${IMPORT}export async function handler() { revalidateTag("posts"); }`,
			},
			{
				name: "same names from another module",
				code: 'import { updateTag } from "./cache";\nexport function f() { updateTag("posts"); }',
			},
		],
		invalid: [
			{
				name: "updateTag in a plain function",
				code: `${IMPORT}export async function handler() { updateTag("posts"); }`,
				errors: [{ messageId: "outsideServerAction" }],
			},
			{
				name: "refresh at module scope",
				code: `${IMPORT}refresh();`,
				errors: [{ messageId: "outsideServerAction" }],
			},
			{
				name: "nested function without the directive",
				code: `${IMPORT}export async function outer() { const inner = async () => { updateTag("posts"); }; }`,
				errors: [{ messageId: "outsideServerAction" }],
			},
		],
	},
);
