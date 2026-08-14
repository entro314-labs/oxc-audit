import { RuleTester } from "oxlint/plugins-dev";

import { noRhfSetValueLoopRule } from "./no-rhf-setvalue-loop.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { useForm } from "react-hook-form";\n';

tester.run("data-layer/no-rhf-setvalue-loop", noRhfSetValueLoopRule, {
	valid: [
		`${IMPORT}const { setValue } = useForm();\nsetValue("name", "a");`,
		`${IMPORT}const { setValues } = useForm();\nfor (const [k, v] of entries) setValues({ [k]: v });`,
		// `setValue` here belongs to something that is not a form.
		'const { setValue } = useSlider();\nitems.forEach((i) => setValue(i, 1));',
	],
	invalid: [
		{
			name: "destructured setValue in a for-of body",
			code: `${IMPORT}const { setValue } = useForm();\nfor (const [k, v] of entries) { setValue(k, v); }`,
			errors: [{ messageId: "loopedSetValue" }],
		},
		{
			name: "destructured setValue in a forEach callback",
			code: `${IMPORT}const { setValue } = useForm();\nentries.forEach(([k, v]) => setValue(k, v));`,
			errors: [{ messageId: "loopedSetValue" }],
		},
		{
			name: "aliased destructure is tracked",
			code: `${IMPORT}const { setValue: write } = useForm();\nentries.forEach(([k, v]) => write(k, v));`,
			errors: [{ messageId: "loopedSetValue" }],
		},
		{
			name: "member access on the whole useForm return",
			code: `${IMPORT}const methods = useForm();\nfor (const k of keys) { methods.setValue(k, 1); }`,
			errors: [{ messageId: "loopedSetValue" }],
		},
	],
});
