import { RuleTester } from "oxlint/plugins-dev";

import { requireZustandCurriedCreateRule } from "./require-zustand-curried-create.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { create } from "zustand";\n';

tester.run("data-layer/require-zustand-curried-create", requireZustandCurriedCreateRule, {
	valid: [
		`${IMPORT}const useStore = create<State>()((set) => ({ count: 0 }));`,
		// No explicit type argument: inference has nothing to lose.
		`${IMPORT}const useStore = create((set) => ({ count: 0 }));`,
		"const thing = create<State>((set) => ({}));",
	],
	invalid: [
		{
			name: "uncurried create with a type argument",
			code: `${IMPORT}const useStore = create<State>((set) => ({ count: 0 }));`,
			errors: [{ messageId: "uncurried" }],
		},
		{
			name: "createStore has the same inference collapse",
			code: 'import { createStore } from "zustand";\nconst store = createStore<State>((set) => ({}));',
			errors: [{ messageId: "uncurried" }],
		},
	],
});
