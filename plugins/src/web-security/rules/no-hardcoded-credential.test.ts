import { RuleTester } from "oxlint/plugins-dev";

import { noHardcodedCredentialRule } from "./no-hardcoded-credential.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("web-security/no-hardcoded-credential", noHardcodedCredentialRule, {
	valid: [
		"const key = process.env.STRIPE_SECRET_KEY;",
		'const placeholder = "sk_live_your_key_here";',
		'const label = "AKIA";',
		// A Supabase anon key is a JWT and belongs in client code, so JWTs are not matched.
		'const anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig";',
		'const testKey = "sk_test_51ABCDEFGHIJKLMNOPQRSTUV";',
	],
	invalid: [
		{
			name: "live Stripe secret key",
			code: 'const key = "sk_live_51ABCDEFGHIJKLMNOPQRSTUVWX";',
			errors: [{ messageId: "hardcodedCredential" }],
		},
		{
			name: "AWS access key ID",
			code: 'const id = "AKIAIOSFODNN7EXAMPLE";',
			errors: [{ messageId: "hardcodedCredential" }],
		},
		{
			name: "GitHub personal access token",
			code: 'const gh = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";',
			errors: [{ messageId: "hardcodedCredential" }],
		},
		{
			name: "Stripe webhook signing secret",
			code: 'const secret = "whsec_abcdefghijklmnopqrstuvwxyz012345";',
			errors: [{ messageId: "hardcodedCredential" }],
		},
		{
			name: "private key block inside a template",
			code: "const pem = `-----BEGIN RSA PRIVATE KEY-----\\nMIIE...`;",
			errors: [{ messageId: "hardcodedCredential" }],
		},
	],
});
