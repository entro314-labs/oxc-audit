import { RuleTester } from "oxlint/plugins-dev";

import { requireAwaitNextRequestApisRule } from "./require-await-next-request-apis.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { cookies, headers, draftMode } from "next/headers";\n';

tester.run("next-react/require-await-next-request-apis", requireAwaitNextRequestApisRule, {
	valid: [
		`${IMPORT}async function f() { const c = await cookies(); }`,
		`${IMPORT}async function f() { const token = (await cookies()).get("t"); }`,
		`${IMPORT}function f() { return cookies().then((c) => c.get("t")); }`,
		`import { use } from "react";\n${IMPORT}function f() { const c = use(cookies()); }`,
		// A same-named local helper is not the Next.js API.
		'function cookies() { return {}; }\nconst c = cookies().get("t");',
	],
	invalid: [
		{
			name: "property read off the un-awaited Promise",
			code: `${IMPORT}async function f() { const t = cookies().get("t"); }`,
			errors: [{ messageId: "unawaited" }],
		},
		{
			name: "assigned without await",
			code: `${IMPORT}async function f() { const h = headers(); }`,
			errors: [{ messageId: "unawaited" }],
		},
		{
			name: "draftMode",
			code: `${IMPORT}async function f() { if (draftMode().isEnabled) return; }`,
			errors: [{ messageId: "unawaited" }],
		},
	],
});
