import { defineRule } from "@oxlint/plugins";

import { collectImportBindings, isModuleExport, unwrapExpression } from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const REACT_MODULES = ["react"] as const;

/**
 * Disallow `<Context.Provider>` for contexts created by `React.createContext`.
 *
 * React 19 renders the context object itself as the provider. Only bindings this rule can
 * trace back to a `createContext()` call are reported, so third-party namespaces that happen
 * to expose a `Provider` member — `<Tooltip.Provider>` and friends — are left alone.
 */
export const noLegacyContextProviderRule = defineRule({
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description:
				"Disallow `<Context.Provider>` for React-created contexts; React 19 renders the context itself as the provider.",
		},
		messages: {
			legacyProvider:
				"React 19 renders the context directly. Use `<{{name}} value={...}>` instead of `<{{name}}.Provider>`.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();
		/** Locals assigned the result of `createContext(...)`. */
		let contextNames = new Set<string>();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
				contextNames = new Set();
			},
			VariableDeclarator(node: ESTree.VariableDeclarator) {
				if (node.init === null || node.id.type !== "Identifier") return;
				const init = unwrapExpression(node.init);
				if (init.type !== "CallExpression") return;
				if (!isModuleExport(init.callee, bindings, REACT_MODULES, "createContext")) return;
				contextNames.add(node.id.name);
			},
			JSXOpeningElement(node: ESTree.JSXOpeningElement) {
				const { name } = node;
				if (name.type !== "JSXMemberExpression") return;
				if (name.property.name !== "Provider") return;
				if (name.object.type !== "JSXIdentifier") return;
				const contextName = name.object.name;
				if (!contextNames.has(contextName)) return;
				context.report({
					node: name,
					messageId: "legacyProvider",
					data: { name: contextName },
					fix: (fixer: Fixer) => fixer.replaceText(name, contextName),
				});
			},
			JSXClosingElement(node: ESTree.JSXClosingElement) {
				const { name } = node;
				if (name.type !== "JSXMemberExpression") return;
				if (name.property.name !== "Provider") return;
				if (name.object.type !== "JSXIdentifier") return;
				const contextName = name.object.name;
				if (!contextNames.has(contextName)) return;
				context.report({
					node: name,
					messageId: "legacyProvider",
					data: { name: contextName },
					fix: (fixer: Fixer) => fixer.replaceText(name, contextName),
				});
			},
		};
	},
});
