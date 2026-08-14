import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, isModuleExport, propertyKeyName, unwrapExpression } from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const AI_MODULES = ["ai", "@ai-sdk"] as const;

/** Core generation entrypoints whose options object v7 reshaped. */
const CORE_ENTRYPOINTS = new Set([
	"Agent",
	"HarnessAgent",
	"ToolLoopAgent",
	"WorkflowAgent",
	"generateObject",
	"generateText",
	"streamObject",
	"streamText",
]);

/** The `tool()` helper, whose schema and approval options both moved. */
const TOOL_ENTRYPOINTS = new Set(["tool"]);

/** Straight key renames on core calls — same value, new name. */
const CORE_RENAMES = new Map<string, string>([
	["experimental_activeTools", "activeTools"],
	["experimental_context", "context"],
	["experimental_output", "output"],
	["experimental_prepareStep", "prepareStep"],
	["experimental_telemetry", "telemetry"],
	["maxTokens", "maxOutputTokens"],
	["onFinish", "onEnd"],
	["system", "instructions"],
]);

/** Core options v7 removed, where the replacement is a different shape rather than a rename. */
const CORE_REMOVED = new Map<string, string>([
	[
		"experimental_attachments",
		"unified `{ type: 'file', mediaType, data }` content parts",
	],
	["maxSteps", "`stopWhen: isStepCount(n)`"],
	["totalUsage", "`usage`, which aggregates every step in v7"],
]);

/** `tool()` renames. */
const TOOL_RENAMES = new Map<string, string>([
	["experimental_toToolResultContent", "toModelOutput"],
	["parameters", "inputSchema"],
]);

/** `tool()` options v7 removed. */
const TOOL_REMOVED = new Map<string, string>([
	["needsApproval", "the agent-level `toolApproval` setting"],
]);

function optionsObjectsOf(node: ESTree.CallExpression): ESTree.ObjectExpression[] {
	const objects: ESTree.ObjectExpression[] = [];
	for (const argument of node.arguments) {
		if (argument.type === "SpreadElement") continue;
		const unwrapped = unwrapExpression(argument);
		if (unwrapped.type === "ObjectExpression") objects.push(unwrapped);
	}
	return objects;
}

function matchesAny(
	callee: ESTree.Expression,
	bindings: ImportBindings,
	names: ReadonlySet<string>,
): boolean {
	for (const name of names) {
		if (isModuleExport(callee, bindings, AI_MODULES, name)) return true;
	}
	return false;
}

/**
 * Disallow AI SDK v6 option names on v7 calls.
 *
 * v7 rejects a `system` message inside `messages` but ignores unknown top-level keys, so a
 * leftover `maxTokens` or `onFinish` produces an unbounded generation or a callback that never
 * fires — with no error at either the type level or runtime.
 */
export const noAiV6OptionsRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow AI SDK v6 option names (`system`, `onFinish`, `maxTokens`, `maxSteps`, `parameters`, surviving `experimental_` keys) on v7 calls, where they are silently ignored.",
		},
		messages: {
			renamed: "`{{key}}` was renamed in AI SDK v7 and is ignored under the old name. Use `{{replacement}}`.",
			removed: "`{{key}}` was removed in AI SDK v7 and is ignored. Use {{replacement}}.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		const inspect = (
			options: ESTree.ObjectExpression,
			renames: ReadonlyMap<string, string>,
			removed: ReadonlyMap<string, string>,
		) => {
			for (const property of options.properties) {
				const key = propertyKeyName(property);
				if (key === null || property.type !== "Property") continue;

				const replacement = renames.get(key);
				if (replacement !== undefined) {
					context.report({
						node: property.key,
						messageId: "renamed",
						data: { key, replacement },
						fix: property.shorthand
							? undefined
							: (fixer: Fixer) => fixer.replaceText(property.key, replacement),
					});
					continue;
				}

				const guidance = removed.get(key);
				if (guidance === undefined) continue;
				context.report({
					node: property.key,
					messageId: "removed",
					data: { key, replacement: guidance },
				});
			}
		};

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				if (matchesAny(node.callee, bindings, CORE_ENTRYPOINTS)) {
					for (const options of optionsObjectsOf(node)) {
						inspect(options, CORE_RENAMES, CORE_REMOVED);
					}
					return;
				}
				if (!matchesAny(node.callee, bindings, TOOL_ENTRYPOINTS)) return;
				for (const options of optionsObjectsOf(node)) {
					inspect(options, TOOL_RENAMES, TOOL_REMOVED);
				}
			},
			NewExpression(node: ESTree.NewExpression) {
				if (!matchesAny(node.callee, bindings, CORE_ENTRYPOINTS)) return;
				for (const argument of node.arguments) {
					if (argument.type === "SpreadElement") continue;
					const options = unwrapExpression(argument);
					if (options.type === "ObjectExpression") inspect(options, CORE_RENAMES, CORE_REMOVED);
				}
			},
		};
	},
});
