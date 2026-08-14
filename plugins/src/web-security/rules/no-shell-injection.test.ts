import { RuleTester } from "oxlint/plugins-dev";

import { noShellInjectionRule } from "./no-shell-injection.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const IMPORT = 'import { exec, execSync, execFile } from "node:child_process";\n';

tester.run("web-security/no-shell-injection", noShellInjectionRule, {
	valid: [
		`${IMPORT}exec("git status", callback);`,
		`${IMPORT}execSync("git rev-parse HEAD");`,
		`${IMPORT}execSync("git " + "status");`,
		// An argument array is never parsed by a shell.
		`${IMPORT}execFile("git", ["checkout", branch]);`,
		// Same names, different module.
		'import { exec } from "./runner";\nexec(`git checkout ${branch}`);',
	],
	invalid: [
		{
			name: "template interpolation",
			code: `${IMPORT}exec(\`git checkout \${branch}\`, callback);`,
			errors: [{ messageId: "shellInjection" }],
		},
		{
			name: "string concatenation",
			code: `${IMPORT}execSync("rm -rf " + directory);`,
			errors: [{ messageId: "shellInjection" }],
		},
	],
});
