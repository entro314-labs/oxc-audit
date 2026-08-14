import { defineRule } from "@oxlint/plugins";

import type { ESTree, Fixer } from "@oxlint/plugins";

/** Zustand 4 subpaths that moved in v5, and where they moved to. */
const MOVED_PATHS = new Map<string, string>([
	["zustand/react/shallow", "zustand/shallow"],
	["zustand/middleware/devtools", "zustand/middleware"],
	["zustand/middleware/persist", "zustand/middleware"],
]);

/**
 * Paths that look interchangeable but are not: `immer` genuinely lives at its own subpath, and
 * importing it from the barrel resolves to nothing.
 */
const IMMER_PATH = "zustand/middleware/immer";

/**
 * Disallow Zustand 4 import paths that moved in v5.
 *
 * These fail at resolution rather than at runtime, but they are the most common leftover in a
 * half-finished v4 -> v5 upgrade, and the `immer` counterpart moves the other way — flagged
 * here so the two are not "fixed" into each other.
 */
export const noZustandV4ImportPathsRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow Zustand 4 import subpaths that moved in v5 (`zustand/react/shallow`, `zustand/middleware/devtools`).",
		},
		messages: {
			movedPath: "`{{from}}` moved in Zustand 5. Import from `{{to}}`.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node: ESTree.ImportDeclaration) {
				const source = node.source.value;
				if (source === IMMER_PATH) return;
				const target = MOVED_PATHS.get(source);
				if (target === undefined) return;
				context.report({
					node: node.source,
					messageId: "movedPath",
					data: { from: source, to: target },
					fix: (fixer: Fixer) => fixer.replaceText(node.source, JSON.stringify(target)),
				});
			},
		};
	},
});
