import { RuleTester } from "oxlint/plugins-dev";

import { noDrizzleLegacyApiRule } from "./no-drizzle-legacy-api.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { drizzle } from "drizzle-orm/node-postgres";\n';

tester.run("data-layer/no-drizzle-legacy-api", noDrizzleLegacyApiRule, {
	valid: [
		`${IMPORT}const db = drizzle(pool, { relations });\nconst rows = await db.query.users.findMany();`,
		'import { array } from "drizzle-orm/pg-core/array";',
		// No Drizzle import, so `_query` here is some other private accessor.
		"const rows = client._query.users;",
	],
	invalid: [
		{
			name: "RQBv1 accessor",
			code: `${IMPORT}const rows = await db._query.users.findMany();`,
			errors: [{ messageId: "relationalQueriesV1" }],
		},
		{
			name: "instance-level casing",
			code: `${IMPORT}const db = drizzle(pool, { casing: "snake_case" });`,
			errors: [{ messageId: "instanceCasing" }],
		},
		{
			name: "moved pg-core subpath",
			code: 'import { array } from "drizzle-orm/pg-core/utils/array";',
			output: 'import { array } from "drizzle-orm/pg-core/array";',
			errors: [{ messageId: "movedPath" }],
		},
	],
});
