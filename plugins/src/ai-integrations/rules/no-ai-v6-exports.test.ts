import { RuleTester } from "oxlint/plugins-dev";

import { noAiV6ExportsRule } from "./no-ai-v6-exports.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("ai-integrations/no-ai-v6-exports", noAiV6ExportsRule, {
	valid: [
		'import { convertToModelMessages, isStepCount } from "ai";',
		'import type { ModelMessage, Tool } from "ai";',
		'import { createGoogle } from "@ai-sdk/google";',
		'import { CoreMessage } from "some-other-sdk";',
	],
	invalid: [
		{
			code: 'import { convertToCoreMessages } from "ai";',
			output: 'import { convertToModelMessages } from "ai";',
			errors: [{ messageId: "renamedExport" }],
		},
		{
			code: 'import type { CoreMessage, CoreTool } from "ai";',
			output: 'import type { ModelMessage, Tool } from "ai";',
			errors: [{ messageId: "renamedExport" }, { messageId: "renamedExport" }],
		},
		{
			code: 'import { createGoogleGenerativeAI } from "@ai-sdk/google";',
			output: 'import { createGoogle } from "@ai-sdk/google";',
			errors: [{ messageId: "renamedExport" }],
		},
		{
			name: "aliased import is reported but left alone",
			code: 'import { stepCountIs as stepCount } from "ai";',
			errors: [{ messageId: "renamedExport" }],
		},
	],
});
