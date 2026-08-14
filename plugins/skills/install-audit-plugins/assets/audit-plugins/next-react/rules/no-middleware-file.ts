import { defineRule } from "@oxlint/plugins";

/** `middleware.ts` / `.js` / `.mjs` / `.mts`, in the project root or under `src/`. */
const MIDDLEWARE_FILE = /(^|[\\/])middleware\.[cm]?[jt]sx?$/;

/**
 * Disallow the `middleware.ts` filename, which Next.js 16 replaced with `proxy.ts`.
 *
 * Next.js 16 still picks `middleware.ts` up, so nothing breaks — the file just stays on the
 * deprecated naming that the 16.3 codemod guidance targets, and mixed repos end up with both
 * conventions in play.
 */
export const noMiddlewareFileRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow the `middleware.ts` filename, replaced by `proxy.ts` in Next.js 16.",
		},
		messages: {
			middlewareFilename:
				"Next.js 16 renamed `middleware.ts` to `proxy.ts`. Rename the file and update the matcher config with it.",
		},
	},
	createOnce(context) {
		return {
			Program() {
				if (!MIDDLEWARE_FILE.test(context.filename)) return;
				context.report({
					loc: { start: { line: 1, column: 0 } },
					messageId: "middlewareFilename",
				});
			},
		};
	},
});
