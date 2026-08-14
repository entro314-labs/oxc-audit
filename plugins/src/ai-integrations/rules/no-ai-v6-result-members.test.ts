import { RuleTester } from "oxlint/plugins-dev";

import { noAiV6ResultMembersRule } from "./no-ai-v6-result-members.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { streamText } from "ai";\n';

tester.run("ai-integrations/no-ai-v6-result-members", noAiV6ResultMembersRule, {
	valid: [
		`${IMPORT}async function read() { for await (const part of result.stream) {} }`,
		`${IMPORT}const { usage } = result;\nconsole.log(result.usage);`,
		`${IMPORT}function handler() { return createUIMessageStreamResponse({ stream }); }`,
		// No AI SDK import: `fullStream` belongs to something else.
		"async function read() { for await (const part of source.fullStream) {} }",
	],
	invalid: [
		{
			name: "fullStream",
			code: `${IMPORT}async function read() { for await (const part of result.fullStream) {} }`,
			errors: [{ messageId: "movedMember" }],
		},
		{
			name: "totalUsage",
			code: `${IMPORT}console.log(result.totalUsage);`,
			errors: [{ messageId: "movedMember" }],
		},
		{
			name: "response helper called as a result method",
			code: `${IMPORT}function handler() { return result.toUIMessageStreamResponse(); }`,
			errors: [{ messageId: "movedMethod" }],
		},
		{
			name: "v4-era data stream response",
			code: `${IMPORT}function handler() { return result.toDataStreamResponse(); }`,
			errors: [{ messageId: "movedMethod" }],
		},
	],
});
