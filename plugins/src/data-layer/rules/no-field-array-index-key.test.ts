import { RuleTester } from "oxlint/plugins-dev";

import { noFieldArrayIndexKeyRule } from "./no-field-array-index-key.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const SETUP =
	'import { useFieldArray } from "react-hook-form";\nconst { fields } = useFieldArray({ control, name: "items" });\n';

tester.run("data-layer/no-field-array-index-key", noFieldArrayIndexKeyRule, {
	valid: [
		`${SETUP}const A = () => fields.map((field, index) => <Row key={field.id} index={index} />);`,
		`${SETUP}const A = () => fields.map((field) => <Row key={field.id} />);`,
		// A plain array is not a field array, so the index key is the caller's business.
		"const A = () => items.map((item, index) => <Row key={index} />);",
	],
	invalid: [
		{
			name: "index used as the key",
			code: `${SETUP}const A = () => fields.map((field, index) => <Row key={index} />);`,
			errors: [{ messageId: "indexKey" }],
		},
		{
			name: "aliased fields binding",
			code: 'import { useFieldArray } from "react-hook-form";\nconst { fields: rows } = useFieldArray({ control, name: "items" });\nconst A = () => rows.map((row, i) => <Row key={i} />);',
			errors: [{ messageId: "indexKey" }],
		},
	],
});
