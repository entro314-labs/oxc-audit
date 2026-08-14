import { RuleTester } from "oxlint/plugins-dev";

import { noReactQueryV4OptionsRule } from "./no-react-query-v4-options.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { useQuery, useMutation, useQueries } from "@tanstack/react-query";\n';

tester.run("data-layer/no-react-query-v4-options", noReactQueryV4OptionsRule, {
	valid: [
		`${IMPORT}const q = useQuery({ queryKey: ["a"], queryFn: fetchA, gcTime: 1000 });`,
		`${IMPORT}const q = useQuery({ queryKey: ["a"], queryFn: fetchA, throwOnError: true });`,
		// Mutation callbacks are still the current API in v5.
		`${IMPORT}const m = useMutation({ mutationFn: save, onSuccess: refetch, onError: report });`,
		// Same option names on an unrelated call.
		"const chart = render({ onSuccess: done, cacheTime: 5 });",
	],
	invalid: [
		{
			name: "cacheTime is renamed",
			code: `${IMPORT}const q = useQuery({ queryKey: ["a"], cacheTime: 5000 });`,
			output: `${IMPORT}const q = useQuery({ queryKey: ["a"], gcTime: 5000 });`,
			errors: [{ messageId: "renamed" }],
		},
		{
			name: "useErrorBoundary is renamed on mutations too",
			code: `${IMPORT}const m = useMutation({ mutationFn: save, useErrorBoundary: true });`,
			output: `${IMPORT}const m = useMutation({ mutationFn: save, throwOnError: true });`,
			errors: [{ messageId: "renamed" }],
		},
		{
			name: "query callbacks are removed and silently ignored",
			code: `${IMPORT}const q = useQuery({ queryKey: ["a"], onSuccess: cache, onError: report });`,
			errors: [{ messageId: "removedFromQuery" }, { messageId: "removedFromQuery" }],
		},
		{
			name: "suspense flag is replaced by the dedicated hook",
			code: `${IMPORT}const q = useQuery({ queryKey: ["a"], suspense: true });`,
			errors: [{ messageId: "removedFromQuery" }],
		},
		{
			name: "options nested inside useQueries are inspected",
			code: `${IMPORT}const r = useQueries({ queries: [{ queryKey: ["a"], onSuccess: cache }] });`,
			errors: [{ messageId: "removedFromQuery" }],
		},
	],
});
