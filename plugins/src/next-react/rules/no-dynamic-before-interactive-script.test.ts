import { RuleTester } from "oxlint/plugins-dev";

import { noDynamicBeforeInteractiveScriptRule } from "./no-dynamic-before-interactive-script.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });

tester.run("next-react/no-dynamic-before-interactive-script", noDynamicBeforeInteractiveScriptRule, {
	valid: [
		'const A = () => <Script strategy="beforeInteractive" src="https://cdn.example.com/a.js" />;',
		'const B = () => <Script strategy="beforeInteractive" src={"https://cdn.example.com/a.js"} />;',
		// A later strategy runs after hydration, where the app can gate it.
		"const C = () => <Script strategy=\"afterInteractive\" src={scriptUrl} />;",
		"const D = () => <Script src={scriptUrl} />;",
		// Not a Script element.
		'const E = () => <Widget strategy="beforeInteractive" src={scriptUrl} />;',
	],
	invalid: [
		{
			name: "identifier src",
			code: 'const A = () => <Script strategy="beforeInteractive" src={scriptUrl} />;',
			errors: [{ messageId: "dynamicBeforeInteractive" }],
		},
		{
			name: "interpolated template src",
			code: 'const A = () => <Script strategy="beforeInteractive" src={`${origin}/a.js`} />;',
			errors: [{ messageId: "dynamicBeforeInteractive" }],
		},
		{
			name: "namespaced element",
			code: 'const A = () => <Next.Script strategy="beforeInteractive" src={scriptUrl} />;',
			errors: [{ messageId: "dynamicBeforeInteractive" }],
		},
	],
});
