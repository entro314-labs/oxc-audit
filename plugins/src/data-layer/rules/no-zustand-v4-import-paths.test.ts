import { RuleTester } from "oxlint/plugins-dev";

import { noZustandV4ImportPathsRule } from "./no-zustand-v4-import-paths.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("data-layer/no-zustand-v4-import-paths", noZustandV4ImportPathsRule, {
	valid: [
		'import { useShallow } from "zustand/shallow";',
		'import { devtools, persist } from "zustand/middleware";',
		// `immer` really does live at its own subpath — importing it from the barrel resolves to nothing.
		'import { immer } from "zustand/middleware/immer";',
	],
	invalid: [
		{
			code: 'import { useShallow } from "zustand/react/shallow";',
			output: 'import { useShallow } from "zustand/shallow";',
			errors: [{ messageId: "movedPath" }],
		},
		{
			code: 'import { devtools } from "zustand/middleware/devtools";',
			output: 'import { devtools } from "zustand/middleware";',
			errors: [{ messageId: "movedPath" }],
		},
	],
});
