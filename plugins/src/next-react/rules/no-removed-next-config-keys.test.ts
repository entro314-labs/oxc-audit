import { RuleTester } from "oxlint/plugins-dev";

import { noRemovedNextConfigKeysRule } from "./no-removed-next-config-keys.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const CONFIG = "next.config.ts";

tester.run("next-react/no-removed-next-config-keys", noRemovedNextConfigKeysRule, {
	valid: [
		{
			code: "export default { images: { remotePatterns: [{ hostname: 'cdn.example.com' }] } };",
			filename: CONFIG,
		},
		{
			code: "export default { experimental: { cacheComponents: true } };",
			filename: CONFIG,
		},
		// `domains` outside `images` is some other option entirely.
		{ code: "export default { auth: { domains: ['a'] } };", filename: CONFIG },
		// Same keys in application code are not Next.js config.
		{ code: "const opts = { publicRuntimeConfig: {} };", filename: "src/app/page.tsx" },
	],
	invalid: [
		{
			name: "images.domains",
			code: "export default { images: { domains: ['cdn.example.com'] } };",
			filename: CONFIG,
			errors: [{ messageId: "removedKey" }],
		},
		{
			name: "runtime config",
			code: "export default { publicRuntimeConfig: { a: 1 }, serverRuntimeConfig: { b: 2 } };",
			filename: CONFIG,
			errors: [{ messageId: "removedKey" }, { messageId: "removedKey" }],
		},
		{
			name: "experimental flags",
			code: "export default { experimental: { ppr: true, useCache: true } };",
			filename: CONFIG,
			errors: [{ messageId: "removedKey" }, { messageId: "removedKey" }],
		},
	],
});
