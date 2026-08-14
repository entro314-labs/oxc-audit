import { definePlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";

/**
 * Type-evidence laundering: code that knows a precise type and then throws it away.
 *
 * Stack-independent, unlike the other four plugins, and syntactic by necessity — these are the
 * few type-safety findings that survive the "custom JS plugins cannot use type information"
 * limit, because each one is visible in the annotation syntax itself rather than in the
 * inferred type. Where a type-aware rule already covers the ground it is preferred; see the
 * README for the overlap with `typescript/no-unsafe-type-assertion`.
 */
const slopStopPlugin = definePlugin({
	meta: { name: "slop-stop" },
	rules: {
		"no-chained-type-assertions": noChainedTypeAssertionsRule,
		"no-known-value-widening": noKnownValueWideningRule,
		"no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
		"no-widen-then-assert": noWidenThenAssertRule,
		"require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
	},
});

export default slopStopPlugin;
