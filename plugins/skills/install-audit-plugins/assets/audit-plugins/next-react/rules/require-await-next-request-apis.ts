import { defineRule } from "@oxlint/plugins";

import {
	collectImportBindings,
	isModuleExport,
	staticMemberName,
} from "../../shared/imports.ts";

import type { ESTree } from "@oxlint/plugins";
import type { ImportBindings } from "../../shared/imports.ts";

const HEADERS_MODULE = ["next/headers"] as const;
const REACT_MODULES = ["react"] as const;

/** Request-time APIs that became async in Next.js 15 and are Promise-returning in 16. */
const ASYNC_REQUEST_APIS = ["connection", "cookies", "draftMode", "headers"] as const;

/** Promise-consuming methods that make an un-awaited call deliberate rather than a bug. */
const PROMISE_METHODS = new Set(["catch", "finally", "then"]);

function isHandledPromise(node: ESTree.CallExpression, bindings: ImportBindings): boolean {
	const { parent } = node;
	if (parent.type === "AwaitExpression") return true;
	// `cookies().then(...)`, `cookies().catch(...)`
	if (parent.type === "MemberExpression" && parent.object === node) {
		const method = staticMemberName(parent);
		if (method !== null && PROMISE_METHODS.has(method)) return true;
	}
	// `use(cookies())` — React's Promise-unwrapping hook.
	if (parent.type === "CallExpression" && parent.arguments.includes(node)) {
		if (isModuleExport(parent.callee, bindings, REACT_MODULES, "use")) return true;
	}
	// Returned or forwarded as a Promise on purpose.
	if (parent.type === "ReturnStatement" || parent.type === "ArrowFunctionExpression") return true;
	return false;
}

/**
 * Require `cookies()`, `headers()`, `draftMode()` and `connection()` to be awaited.
 *
 * These became async in Next.js 15. Un-awaited, they return a Promise that reads as a truthy
 * object, so `cookies().get('session')` throws at runtime rather than failing to compile —
 * and only on the code path that runs it.
 */
export const requireAwaitNextRequestApisRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require the async Next.js request-time APIs (`cookies()`, `headers()`, `draftMode()`, `connection()`) to be awaited or otherwise consumed as Promises.",
		},
		messages: {
			unawaited:
				"`{{name}}()` is async in Next.js 15+ and returns a Promise. Await it — reading a property off the un-awaited Promise throws at runtime.",
		},
	},
	createOnce(context) {
		let bindings: ImportBindings = new Map();

		return {
			Program(node) {
				bindings = collectImportBindings(node);
			},
			CallExpression(node: ESTree.CallExpression) {
				const name = ASYNC_REQUEST_APIS.find((api) =>
					isModuleExport(node.callee, bindings, HEADERS_MODULE, api),
				);
				if (name === undefined) return;
				if (isHandledPromise(node, bindings)) return;
				context.report({ node, messageId: "unawaited", data: { name } });
			},
		};
	},
});
