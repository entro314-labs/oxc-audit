import { RuleTester } from "oxlint/plugins-dev";

import { noClientHooksInServerComponentRule } from "./no-client-hooks-in-server-component.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const APP_FILE = "src/app/dashboard/page.tsx";

tester.run(
	"next-react/no-client-hooks-in-server-component",
	noClientHooksInServerComponentRule,
	{
		valid: [
			{
				name: "directive present",
				code: '"use client";\nimport { useState } from "react";',
				filename: APP_FILE,
			},
			{
				name: "server-safe React imports",
				code: 'import { cache, use, Suspense } from "react";',
				filename: APP_FILE,
			},
			{
				name: "outside the App Router tree",
				code: 'import { useState } from "react";',
				filename: "src/components/counter.tsx",
			},
			{
				name: "type-only import never reaches the renderer",
				code: 'import type { useState } from "react";',
				filename: APP_FILE,
			},
		],
		invalid: [
			{
				name: "useState without the directive",
				code: 'import { useState } from "react";',
				filename: APP_FILE,
				errors: [{ messageId: "missingUseClient" }],
			},
			{
				name: "useEffectEvent is an explicit error in a Server Component",
				code: 'import { useEffectEvent, useEffect } from "react";',
				filename: APP_FILE,
				errors: [{ messageId: "missingUseClient" }, { messageId: "missingUseClient" }],
			},
		],
	},
);
