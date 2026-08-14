import { RuleTester } from "oxlint/plugins-dev";

import { noRemovedVitestExportsRule } from "./no-removed-vitest-exports.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("ts-tooling/no-removed-vitest-exports", noRemovedVitestExportsRule, {
	valid: [
		'import type { TestError, ViteUserConfig } from "vitest";',
		'import type { BrowserProvider } from "vitest/node";',
		'import { describe, it, expect } from "vitest";',
	],
	invalid: [
		{
			code: 'import type { ErrorWithDiff } from "vitest";',
			output: 'import type { TestError } from "vitest";',
			errors: [{ messageId: "replacedExport" }],
		},
		{
			code: 'import type { UserConfig } from "vitest";',
			output: 'import type { ViteUserConfig } from "vitest";',
			errors: [{ messageId: "replacedExport" }],
		},
		{
			name: "Node-only type must move modules, so no in-place rename",
			code: 'import type { BrowserProvider } from "vitest";',
			errors: [{ messageId: "replacedExport" }],
		},
	],
});
