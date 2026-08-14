import { RuleTester } from "oxlint/plugins-dev";

import { noZodToJsonSchemaPackageRule } from "./no-zod-to-json-schema-package.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("data-layer/no-zod-to-json-schema-package", noZodToJsonSchemaPackageRule, {
	valid: ['import { z } from "zod";', 'import { toJSONSchema } from "zod";'],
	invalid: [
		{
			code: 'import zodToJsonSchema from "zod-to-json-schema";',
			errors: [{ messageId: "replacedPackage" }],
		},
		{
			code: 'import { generateSchema } from "@anatine/zod-openapi";',
			errors: [{ messageId: "replacedPackage" }],
		},
	],
});
