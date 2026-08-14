import { definePlugin } from "@oxlint/plugins";

import { noDrizzleLegacyApiRule } from "./rules/no-drizzle-legacy-api.ts";
import { noFieldArrayIndexKeyRule } from "./rules/no-field-array-index-key.ts";
import { noReactQueryRemovedExportsRule } from "./rules/no-react-query-removed-exports.ts";
import { noReactQueryV4OptionsRule } from "./rules/no-react-query-v4-options.ts";
import { noRhfSetValueLoopRule } from "./rules/no-rhf-setvalue-loop.ts";
import { noZodLegacyErrorParamsRule } from "./rules/no-zod-legacy-error-params.ts";
import { noZodRemovedMethodsRule } from "./rules/no-zod-removed-methods.ts";
import { noZodSafeParseJsonParseRule } from "./rules/no-zod-safe-parse-json-parse.ts";
import { noZodShapeSpreadDropsRefinementsRule } from "./rules/no-zod-shape-spread-drops-refinements.ts";
import { noZodSingleArgRecordRule } from "./rules/no-zod-single-arg-record.ts";
import { noZodStringFormatMethodsRule } from "./rules/no-zod-string-format-methods.ts";
import { noZodToJsonSchemaPackageRule } from "./rules/no-zod-to-json-schema-package.ts";
import { noZodTrimAfterMinLengthRule } from "./rules/no-zod-trim-after-min-length.ts";
import { noZustandV4ImportPathsRule } from "./rules/no-zustand-v4-import-paths.ts";
import { requireAsyncParseForAsyncSchemaRule } from "./rules/require-async-parse-for-async-schema.ts";
import { requireZustandCurriedCreateRule } from "./rules/require-zustand-curried-create.ts";

/**
 * Migration residue in the data and validation layer: Zod 3 syntax under Zod 4, TanStack
 * Query v4 options under v5, Zustand 4 import paths under v5, and Drizzle APIs the 1.0 line
 * removed. Nearly all of these keep type-checking and keep running — they just stop doing
 * what the code says they do.
 *
 * Three Zod rules here are not version residue at all but standing footguns, where a chain
 * that reads correctly validates something other than what the author meant.
 */
const dataLayerPlugin = definePlugin({
	meta: { name: "data-layer" },
	rules: {
		"no-drizzle-legacy-api": noDrizzleLegacyApiRule,
		"no-field-array-index-key": noFieldArrayIndexKeyRule,
		"no-react-query-removed-exports": noReactQueryRemovedExportsRule,
		"no-react-query-v4-options": noReactQueryV4OptionsRule,
		"no-rhf-setvalue-loop": noRhfSetValueLoopRule,
		"no-zod-legacy-error-params": noZodLegacyErrorParamsRule,
		"no-zod-removed-methods": noZodRemovedMethodsRule,
		"no-zod-safe-parse-json-parse": noZodSafeParseJsonParseRule,
		"no-zod-shape-spread-drops-refinements": noZodShapeSpreadDropsRefinementsRule,
		"no-zod-single-arg-record": noZodSingleArgRecordRule,
		"no-zod-string-format-methods": noZodStringFormatMethodsRule,
		"no-zod-to-json-schema-package": noZodToJsonSchemaPackageRule,
		"no-zod-trim-after-min-length": noZodTrimAfterMinLengthRule,
		"no-zustand-v4-import-paths": noZustandV4ImportPathsRule,
		"require-async-parse-for-async-schema": requireAsyncParseForAsyncSchemaRule,
		"require-zustand-curried-create": requireZustandCurriedCreateRule,
	},
});

export default dataLayerPlugin;
