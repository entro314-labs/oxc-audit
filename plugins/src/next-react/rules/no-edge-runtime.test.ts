import { RuleTester } from "oxlint/plugins-dev";

import { noEdgeRuntimeRule } from "./no-edge-runtime.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("next-react/no-edge-runtime", noEdgeRuntimeRule, {
	valid: [
		'export const runtime = "nodejs";',
		'const runtime = "edge";',
		'export const dynamic = "edge";',
	],
	invalid: [
		{ code: 'export const runtime = "edge";', errors: [{ messageId: "edgeRuntime" }] },
		{
			name: "satisfies wrapper is unwrapped",
			code: 'export const runtime = "edge" satisfies string;',
			errors: [{ messageId: "edgeRuntime" }],
		},
	],
});
