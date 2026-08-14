import { definePlugin } from "@oxlint/plugins";

import { noBrowserClientOnServerRule } from "./rules/no-browser-client-on-server.ts";
import { noDeprecatedAuthHelpersRule } from "./rules/no-deprecated-auth-helpers.ts";
import { noGetSessionForAuthorizationRule } from "./rules/no-get-session-for-authorization.ts";
import { noModuleScopeServerClientRule } from "./rules/no-module-scope-server-client.ts";
import { requireErrorCheckRule } from "./rules/require-error-check.ts";

/**
 * Supabase auth and client-boundary rules.
 *
 * These are the CRITICAL items from `supabase.md`, and they are security rules rather than
 * migration rules: a server-side `getSession()` trusts a forgeable cookie, a module-scope
 * client serves one user's session to the next, and an undestructured `error` turns an RLS
 * denial into an empty result set.
 */
const supabasePlugin = definePlugin({
	meta: { name: "supabase" },
	rules: {
		"no-browser-client-on-server": noBrowserClientOnServerRule,
		"no-deprecated-auth-helpers": noDeprecatedAuthHelpersRule,
		"no-get-session-for-authorization": noGetSessionForAuthorizationRule,
		"no-module-scope-server-client": noModuleScopeServerClientRule,
		"require-error-check": requireErrorCheckRule,
	},
});

export default supabasePlugin;
