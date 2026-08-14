import { definePlugin } from "@oxlint/plugins";

import { noRemovedVitestConfigRule } from "./rules/no-removed-vitest-config.ts";
import { noRemovedVitestExportsRule } from "./rules/no-removed-vitest-exports.ts";

/**
 * Test and build toolchain: Vitest 3 -> 4 removals and the Vite 8 `server.ws` rename.
 *
 * Deliberately narrow. The other Vitest findings in the audit prompts — un-awaited async
 * assertions and hoisted `vi.mock` calls nested in blocks — are already covered natively by
 * `vitest/valid-expect` (with `asyncMatchers`), `vitest/require-awaited-expect-poll` and
 * `vitest/hoisted-apis-on-top`, which the shipped preset enables instead.
 */
const tsToolingPlugin = definePlugin({
	meta: { name: "ts-tooling" },
	rules: {
		"no-removed-vitest-config": noRemovedVitestConfigRule,
		"no-removed-vitest-exports": noRemovedVitestExportsRule,
	},
});

export default tsToolingPlugin;
