import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, importsAnyModule, staticMemberName } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";

const AI_MODULES = ["ai", "@ai-sdk"] as const;

/** Result members v7 moved or renamed. */
const MOVED_MEMBERS = new Map<string, string>([
	["fullStream", "`result.stream`"],
	["partialObjectStream", "`result.partialOutputStream` when using the `output` spec"],
	["totalUsage", "`result.usage`, which aggregates every step in v7"],
]);

/**
 * Response helpers that moved from result methods to standalone functions. The v4-era
 * `toDataStreamResponse` is gone outright.
 */
const MOVED_METHODS = new Map<string, string>([
	[
		"toDataStreamResponse",
		"`createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`",
	],
	[
		"toUIMessageStreamResponse",
		"the standalone `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`",
	],
	["toTextStreamResponse", "the standalone `createTextStreamResponse({ stream: result.textStream })`"],
	["pipeUIMessageStreamToResponse", "the standalone `pipeUIMessageStreamToResponse({ stream, response })`"],
	["pipeTextStreamToResponse", "the standalone `pipeTextStreamToResponse({ stream, response })`"],
]);

/**
 * Disallow AI SDK v6 result members in files that import the SDK.
 *
 * The receiver cannot be traced to a `generateText` result without type information, so this
 * matches on member name within an AI-SDK-importing file. The names are specific enough that
 * this holds up; `no-ai-v6-options` covers the call-site half of the same migration.
 */
export const noAiV6ResultMembersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow AI SDK v6 result members (`fullStream`, `totalUsage`, `partialObjectStream`) and the result-method response helpers v7 replaced with standalone functions.",
		},
		messages: {
			movedMember: "`{{name}}` is the AI SDK v6 shape. Use {{replacement}}.",
			movedMethod:
				"`{{name}}()` as a result method is the AI SDK v6 shape. The documented v7 pattern is {{replacement}}.",
		},
	},
	createOnce(context) {
		let importsAiSdk = false;

		return {
			Program(node) {
				importsAiSdk = importsAnyModule(collectImportBindings(node), AI_MODULES);
			},
			MemberExpression(node: ESTree.MemberExpression) {
				if (!importsAiSdk) return;
				const name = staticMemberName(node);
				if (name === null) return;

				const method = MOVED_METHODS.get(name);
				if (method !== undefined && node.parent.type === "CallExpression") {
					context.report({
						node,
						messageId: "movedMethod",
						data: { name, replacement: method },
					});
					return;
				}

				const member = MOVED_MEMBERS.get(name);
				if (member === undefined) return;
				context.report({ node, messageId: "movedMember", data: { name, replacement: member } });
			},
		};
	},
});
