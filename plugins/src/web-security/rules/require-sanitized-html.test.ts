import { RuleTester } from "oxlint/plugins-dev";

import { requireSanitizedHtmlRule } from "./require-sanitized-html.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });

tester.run("web-security/require-sanitized-html", requireSanitizedHtmlRule, {
	valid: [
		"const A = () => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }} />;",
		"const B = () => <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }} />;",
		'const C = () => <div dangerouslySetInnerHTML={{ __html: "<b>static</b>" }} />;',
		"element.textContent = userInput;",
		"element.innerHTML = sanitize(userInput);",
		'element.innerHTML = "<b>static</b>";',
	],
	invalid: [
		{
			name: "raw value into the JSX prop",
			code: "const A = () => <div dangerouslySetInnerHTML={{ __html: body }} />;",
			errors: [{ messageId: "unsanitizedJsx" }],
		},
		{
			name: "interpolated template into the JSX prop",
			code: "const A = () => <div dangerouslySetInnerHTML={{ __html: `<p>${body}</p>` }} />;",
			errors: [{ messageId: "unsanitizedJsx" }],
		},
		{
			name: "raw assignment to innerHTML",
			code: "element.innerHTML = userInput;",
			errors: [{ messageId: "unsanitizedSink" }],
		},
		{
			name: "interpolated assignment to outerHTML",
			code: "element.outerHTML = `<div>${userInput}</div>`;",
			errors: [{ messageId: "unsanitizedSink" }],
		},
	],
});
