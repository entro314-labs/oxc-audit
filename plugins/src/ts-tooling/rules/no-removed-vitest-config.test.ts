import { RuleTester } from "oxlint/plugins-dev";

import { noRemovedVitestConfigRule } from "./no-removed-vitest-config.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const CONFIG = "vitest.config.ts";

tester.run("ts-tooling/no-removed-vitest-config", noRemovedVitestConfigRule, {
	valid: [
		{ code: "export default { test: { projects: ['packages/*'] } };", filename: CONFIG },
		{ code: "export default { server: { ws: { port: 24678 } } };", filename: "vite.config.ts" },
		// Disabling HMR outright is still spelled `server.hmr: false`.
		{ code: "export default { server: { hmr: false } };", filename: "vite.config.ts" },
		// Application code that happens to use the same key names.
		{ code: "const opts = { workspace: 'a', minWorkers: 2 };", filename: "src/pool.ts" },
	],
	invalid: [
		{
			name: "workspace moved to projects",
			code: "export default { test: { workspace: ['packages/*'] } };",
			filename: CONFIG,
			errors: [{ messageId: "removedKey" }],
		},
		{
			name: "minWorkers and match globs are gone",
			code: "export default { test: { minWorkers: 1, environmentMatchGlobs: [] } };",
			filename: CONFIG,
			errors: [{ messageId: "removedKey" }, { messageId: "removedKey" }],
		},
		{
			name: "server.hmr renamed to server.ws",
			code: "export default { server: { hmr: { port: 24678 } } };",
			filename: "vite.config.ts",
			errors: [{ messageId: "renamedKey" }],
		},
	],
});
