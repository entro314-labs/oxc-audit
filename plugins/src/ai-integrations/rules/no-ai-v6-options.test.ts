import { RuleTester } from "oxlint/plugins-dev";

import { noAiV6OptionsRule } from "./no-ai-v6-options.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { generateText, streamText, tool } from "ai";\n';

tester.run("ai-integrations/no-ai-v6-options", noAiV6OptionsRule, {
	valid: [
		`${IMPORT}const r = await generateText({ model, instructions: "be brief", maxOutputTokens: 500 });`,
		`${IMPORT}const r = streamText({ model, onEnd: log, stopWhen: isStepCount(5) });`,
		`${IMPORT}const t = tool({ inputSchema: schema, execute });`,
		// Same option names on an unrelated call.
		'const job = enqueue({ system: "cron", maxTokens: 10 });',
	],
	invalid: [
		{
			name: "system renames to instructions",
			code: `${IMPORT}const r = await generateText({ model, system: "be brief" });`,
			output: `${IMPORT}const r = await generateText({ model, instructions: "be brief" });`,
			errors: [{ messageId: "renamed" }],
		},
		{
			name: "onFinish and maxTokens both rename",
			code: `${IMPORT}const r = streamText({ model, onFinish: log, maxTokens: 500 });`,
			output: `${IMPORT}const r = streamText({ model, onEnd: log, maxOutputTokens: 500 });`,
			errors: [{ messageId: "renamed" }, { messageId: "renamed" }],
		},
		{
			name: "maxSteps has no rename — the replacement is a different shape",
			code: `${IMPORT}const r = await generateText({ model, maxSteps: 5 });`,
			errors: [{ messageId: "removed" }],
		},
		{
			name: "surviving experimental_ prefix",
			code: `${IMPORT}const r = await generateText({ model, experimental_telemetry: t });`,
			output: `${IMPORT}const r = await generateText({ model, telemetry: t });`,
			errors: [{ messageId: "renamed" }],
		},
		{
			name: "tool parameters renames to inputSchema",
			code: `${IMPORT}const t = tool({ parameters: schema, execute });`,
			output: `${IMPORT}const t = tool({ inputSchema: schema, execute });`,
			errors: [{ messageId: "renamed" }],
		},
		{
			name: "tool needsApproval moved to the agent level",
			code: `${IMPORT}const t = tool({ inputSchema: schema, needsApproval: true });`,
			errors: [{ messageId: "removed" }],
		},
		{
			name: "agent constructed with new",
			code: 'import { Agent } from "ai";\nconst a = new Agent({ model, system: "hi" });',
			output: 'import { Agent } from "ai";\nconst a = new Agent({ model, instructions: "hi" });',
			errors: [{ messageId: "renamed" }],
		},
	],
});
