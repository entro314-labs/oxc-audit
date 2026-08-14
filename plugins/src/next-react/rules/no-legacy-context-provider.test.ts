import { RuleTester } from "oxlint/plugins-dev";

import { noLegacyContextProviderRule } from "./no-legacy-context-provider.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const IMPORT = 'import { createContext } from "react";\n';

tester.run("next-react/no-legacy-context-provider", noLegacyContextProviderRule, {
	valid: [
		`${IMPORT}const Theme = createContext(null);\nconst App = () => <Theme value={theme}>{children}</Theme>;`,
		// A third-party namespace that exposes a `Provider` member is not a React context.
		'import * as Tooltip from "@radix-ui/react-tooltip";\nconst App = () => <Tooltip.Provider>{children}</Tooltip.Provider>;',
		// Untraceable binding: not reported rather than guessed at.
		'import { Theme } from "./theme";\nconst App = () => <Theme.Provider value={t}>{children}</Theme.Provider>;',
	],
	invalid: [
		{
			name: "self-closing provider",
			code: `${IMPORT}const Theme = createContext(null);\nconst App = () => <Theme.Provider value={theme} />;`,
			output: `${IMPORT}const Theme = createContext(null);\nconst App = () => <Theme value={theme} />;`,
			errors: [{ messageId: "legacyProvider" }],
		},
		{
			name: "opening and closing tags are both rewritten",
			code: `${IMPORT}const Theme = createContext(null);\nconst App = () => <Theme.Provider value={theme}>{children}</Theme.Provider>;`,
			output: `${IMPORT}const Theme = createContext(null);\nconst App = () => <Theme value={theme}>{children}</Theme>;`,
			errors: [{ messageId: "legacyProvider" }, { messageId: "legacyProvider" }],
		},
	],
});
