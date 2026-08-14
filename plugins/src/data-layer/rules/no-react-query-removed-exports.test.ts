import { RuleTester } from "oxlint/plugins-dev";

import { noReactQueryRemovedExportsRule } from "./no-react-query-removed-exports.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("data-layer/no-react-query-removed-exports", noReactQueryRemovedExportsRule, {
	valid: [
		'import { HydrationBoundary } from "@tanstack/react-query";',
		'import { Hydrate } from "some-other-package";',
	],
	invalid: [
		{
			name: "Hydrate renames to HydrationBoundary",
			code: 'import { Hydrate } from "@tanstack/react-query";',
			output: 'import { HydrationBoundary } from "@tanstack/react-query";',
			errors: [{ messageId: "replacedExport" }],
		},
		{
			name: "an aliased import is reported but not rewritten",
			code: 'import { Hydrate as H } from "@tanstack/react-query";',
			errors: [{ messageId: "replacedExport" }],
		},
		{
			name: "top-level isServer has no drop-in replacement",
			code: 'import { isServer } from "@tanstack/react-query";',
			errors: [{ messageId: "replacedExport" }],
		},
	],
});
