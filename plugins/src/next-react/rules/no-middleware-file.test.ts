import { RuleTester } from "oxlint/plugins-dev";

import { noMiddlewareFileRule } from "./no-middleware-file.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const CODE = "export function middleware() {}";

tester.run("next-react/no-middleware-file", noMiddlewareFileRule, {
	valid: [
		{ code: CODE, filename: "proxy.ts" },
		{ code: CODE, filename: "src/proxy.ts" },
		// Not the routing entrypoint — a module that merely has "middleware" in its path.
		{ code: CODE, filename: "src/lib/middleware/auth.ts" },
	],
	invalid: [
		{ code: CODE, filename: "middleware.ts", errors: [{ messageId: "middlewareFilename" }] },
		{ code: CODE, filename: "src/middleware.ts", errors: [{ messageId: "middlewareFilename" }] },
	],
});
