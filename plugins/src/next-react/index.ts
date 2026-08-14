import { definePlugin } from "@oxlint/plugins";

import { noCachePrimitiveOutsideServerActionRule } from "./rules/no-cache-primitive-outside-server-action.ts";
import { noClientHooksInServerComponentRule } from "./rules/no-client-hooks-in-server-component.ts";
import { noDynamicBeforeInteractiveScriptRule } from "./rules/no-dynamic-before-interactive-script.ts";
import { noEdgeRuntimeRule } from "./rules/no-edge-runtime.ts";
import { noLegacyContextProviderRule } from "./rules/no-legacy-context-provider.ts";
import { noLegacyNextModulesRule } from "./rules/no-legacy-next-modules.ts";
import { noMiddlewareFileRule } from "./rules/no-middleware-file.ts";
import { noRemovedNextConfigKeysRule } from "./rules/no-removed-next-config-keys.ts";
import { requireAwaitNextRequestApisRule } from "./rules/require-await-next-request-apis.ts";

/**
 * Next.js 16 and React 19 migration residue: deprecated route config, removed `next.config`
 * keys, the request-time APIs that became async, and React 18 idioms that React 19 replaced.
 */
const nextReactPlugin = definePlugin({
	meta: { name: "next-react" },
	rules: {
		"no-cache-primitive-outside-server-action": noCachePrimitiveOutsideServerActionRule,
		"no-client-hooks-in-server-component": noClientHooksInServerComponentRule,
		"no-dynamic-before-interactive-script": noDynamicBeforeInteractiveScriptRule,
		"no-edge-runtime": noEdgeRuntimeRule,
		"no-legacy-context-provider": noLegacyContextProviderRule,
		"no-legacy-next-modules": noLegacyNextModulesRule,
		"no-middleware-file": noMiddlewareFileRule,
		"no-removed-next-config-keys": noRemovedNextConfigKeysRule,
		"require-await-next-request-apis": requireAwaitNextRequestApisRule,
	},
});

export default nextReactPlugin;
