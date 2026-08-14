import { RuleTester } from "oxlint/plugins-dev";

import { noLegacyNextModulesRule } from "./no-legacy-next-modules.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("next-react/no-legacy-next-modules", noLegacyNextModulesRule, {
	valid: [
		'import Image from "next/image";',
		'import { useActionState } from "react";',
		'import { revalidateTag, updateTag } from "next/cache";',
		'import { catchError } from "next/error";',
		'import { useState, useRef } from "react";',
	],
	invalid: [
		{
			code: 'import Image from "next/legacy/image";',
			errors: [{ messageId: "legacyModule" }],
		},
		{
			code: 'import { unstable_cache } from "next/cache";',
			errors: [{ messageId: "legacyExport" }],
		},
		{
			code: 'import { unstable_catchError, unstable_retry } from "next/error";',
			errors: [{ messageId: "legacyExport" }, { messageId: "legacyExport" }],
		},
		{
			code: 'import { useFormState } from "react-dom";',
			errors: [{ messageId: "legacyExport" }],
		},
		{
			code: 'import { forwardRef } from "react";',
			errors: [{ messageId: "legacyExport" }],
		},
	],
});
