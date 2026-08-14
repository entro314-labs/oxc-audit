import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, isModuleExport, unwrapExpression } from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const CHILD_PROCESS_MODULES = ["node:child_process", "child_process"] as const;

/** Functions that hand their command string to a shell for interpretation. */
const SHELL_FUNCTIONS = ["exec", "execSync"] as const;

/** `true` when the command string is assembled from runtime values. */
function isInterpolated(node: ESTree.Expression): boolean {
	const command = unwrapExpression(node);
	if (command.type === "TemplateLiteral") return command.expressions.length > 0;
	if (command.type !== "BinaryExpression" || command.operator !== "+") return false;
	// A concatenation of pure literals is still a constant command.
	const isLiteral = (side: ESTree.Node): boolean =>
		side.type === "Literal" ||
		(side.type === "BinaryExpression" && isLiteral(side.left) && isLiteral(side.right));
	return !(isLiteral(command.left) && isLiteral(command.right));
}

/**
 * Disallow building shell commands from runtime values.
 *
 * `exec` and `execSync` pass their argument to `/bin/sh`, so any interpolated value is shell
 * syntax, not data: a filename containing `; rm -rf ~` is two commands. `execFile` and
 * `spawn` take an argument array that is never parsed by a shell, which removes the
 * possibility rather than trying to escape around it.
 */
export const noShellInjectionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow interpolated command strings passed to `exec` / `execSync`, where interpolated values are interpreted as shell syntax.",
		},
		messages: {
			shellInjection:
				"`{{name}}` passes this string to a shell, so an interpolated value becomes shell syntax rather than an argument. Use `execFile`/`spawn` with an argument array instead.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				const name = SHELL_FUNCTIONS.find((shellFunction) =>
					isModuleExport(node.callee, bindings, CHILD_PROCESS_MODULES, shellFunction),
				);
				if (name === undefined) return;
				const [command] = node.arguments;
				if (command === undefined || command.type === "SpreadElement") return;
				if (!isInterpolated(command)) return;
				context.report({ node, messageId: "shellInjection", data: { name } });
			},
		};
	},
});
