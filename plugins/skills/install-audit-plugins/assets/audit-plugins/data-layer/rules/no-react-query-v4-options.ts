import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	findProperty,
	isModuleExport,
	propertyKeyName,
	unwrapExpression,
} from "../../shared/imports.ts";

import type { ESTree, Fixer } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const QUERY_MODULES = ["@tanstack/react-query", "@tanstack/query-core"] as const;

/** Hooks and option factories whose options object describes a query. */
const QUERY_ENTRYPOINTS = new Set([
	"infiniteQueryOptions",
	"queryOptions",
	"useInfiniteQuery",
	"usePrefetchInfiniteQuery",
	"usePrefetchQuery",
	"useQuery",
	"useSuspenseInfiniteQuery",
	"useSuspenseQuery",
]);
/** Options objects that describe a mutation, where the lifecycle callbacks are still current. */
const MUTATION_ENTRYPOINTS = new Set(["mutationOptions", "useMutation"]);
/** Takes `{ queries: [...] }`, so the per-query options sit one level down. */
const QUERY_LIST_ENTRYPOINTS = new Set(["useQueries", "useSuspenseQueries"]);

/** Straight renames — same semantics, new key. */
const RENAMED_OPTIONS = new Map<string, string>([
	["cacheTime", "gcTime"],
	["useErrorBoundary", "throwOnError"],
]);

/** Options v5 removed from queries, with the replacement pattern. */
const REMOVED_QUERY_OPTIONS = new Map<string, string>([
	["isDataEqual", "`structuralSharing`"],
	["keepPreviousData", "`placeholderData: keepPreviousData`"],
	["onError", "an error branch derived from the returned `error`, or a global `QueryCache` callback"],
	["onSettled", "state derived from the returned query result"],
	["onSuccess", "state derived from the returned `data`, or a global `QueryCache` callback"],
	["suspense", "the `useSuspenseQuery` / `useSuspenseInfiniteQuery` hooks"],
]);

function optionsObjectOf(node: ESTree.CallExpression): ESTree.ObjectExpression | null {
	const [first] = node.arguments;
	if (first === undefined || first.type === "SpreadElement") return null;
	const unwrapped = unwrapExpression(first);
	return unwrapped.type === "ObjectExpression" ? unwrapped : null;
}

function matchedEntrypoint(
	callee: ESTree.Expression,
	bindings: ImportBindings,
	names: ReadonlySet<string>,
): boolean {
	for (const name of names) {
		if (isModuleExport(callee, bindings, QUERY_MODULES, name)) return true;
	}
	return false;
}

/**
 * Disallow TanStack Query v4 options that v5 renamed or removed.
 *
 * The removed query callbacks are the dangerous half: v5 ignores `onSuccess`/`onError` on a
 * query instead of erroring, so side effects wired through them stop running silently.
 */
export const noReactQueryV4OptionsRule = defineRule({
	meta: {
		type: "problem",
		fixable: "code",
		docs: {
			description:
				"Disallow TanStack Query v4 options (`cacheTime`, `useErrorBoundary`, `suspense`, query-level `onSuccess`/`onError`/`onSettled`) that v5 renamed or silently ignores.",
		},
		messages: {
			renamed: "`{{key}}` was renamed in TanStack Query v5. Use `{{replacement}}`.",
			removedFromQuery:
				"`{{key}}` was removed from queries in TanStack Query v5 and is ignored at runtime. Use {{replacement}}.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		const inspect = (options: ESTree.ObjectExpression, isQuery: boolean) => {
			for (const property of options.properties) {
				const key = propertyKeyName(property);
				if (key === null || property.type !== "Property") continue;

				const renamed = RENAMED_OPTIONS.get(key);
				if (renamed !== undefined) {
					context.report({
						node: property.key,
						messageId: "renamed",
						data: { key, replacement: renamed },
						fix: property.shorthand
							? undefined
							: (fixer: Fixer) => fixer.replaceText(property.key, renamed),
					});
					continue;
				}

				if (!isQuery) continue;
				const removed = REMOVED_QUERY_OPTIONS.get(key);
				if (removed === undefined) continue;
				context.report({
					node: property.key,
					messageId: "removedFromQuery",
					data: { key, replacement: removed },
				});
			}
		};

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				const { callee } = node;
				if (matchedEntrypoint(callee, bindings, QUERY_ENTRYPOINTS)) {
					const options = optionsObjectOf(node);
					if (options !== null) inspect(options, true);
					return;
				}
				if (matchedEntrypoint(callee, bindings, MUTATION_ENTRYPOINTS)) {
					const options = optionsObjectOf(node);
					if (options !== null) inspect(options, false);
					return;
				}
				if (!matchedEntrypoint(callee, bindings, QUERY_LIST_ENTRYPOINTS)) return;
				const options = optionsObjectOf(node);
				const queries = options === null ? null : findProperty(options, "queries");
				if (queries === null) return;
				const list = unwrapExpression(queries.value);
				if (list.type !== "ArrayExpression") return;
				for (const element of list.elements) {
					if (element === null || element.type === "SpreadElement") continue;
					const entry = unwrapExpression(element);
					if (entry.type === "ObjectExpression") inspect(entry, true);
				}
			},
		};
	},
});
