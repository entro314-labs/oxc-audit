import type { ESTree } from "@oxlint/plugins";

/** Stand-in export name for `import ns from "mod"`. */
export const DEFAULT_IMPORT = "default";
/** Stand-in export name for `import * as ns from "mod"`. */
export const NAMESPACE_IMPORT = "*";

export interface ImportBinding {
	/** Module specifier the binding was imported from, verbatim. */
	readonly source: string;
	/** Exported name, or {@link DEFAULT_IMPORT} / {@link NAMESPACE_IMPORT}. */
	readonly imported: string;
	/** `true` for `import type` / `import { type X }`, which never appears in value position. */
	readonly typeOnly: boolean;
}

/** Local binding name -> where it was imported from. */
export type ImportBindings = ReadonlyMap<string, ImportBinding>;

function moduleExportName(node: ESTree.ModuleExportName): string {
	return node.type === "Identifier" ? node.name : node.value;
}

/**
 * Index every top-level import in a file by its local binding name.
 *
 * Rules anchor on this rather than on bare identifier names, so `z.email()` is only reported
 * when `z` actually came from `zod` and a project-local `z` helper is left alone.
 */
export function collectImportBindings(program: ESTree.Program): ImportBindings {
	const bindings = new Map<string, ImportBinding>();
	for (const statement of program.body) {
		if (statement.type !== "ImportDeclaration") continue;
		const source = statement.source.value;
		const declarationTypeOnly = statement.importKind === "type";
		for (const specifier of statement.specifiers) {
			const imported =
				specifier.type === "ImportDefaultSpecifier"
					? DEFAULT_IMPORT
					: specifier.type === "ImportNamespaceSpecifier"
						? NAMESPACE_IMPORT
						: moduleExportName(specifier.imported);
			const typeOnly =
				declarationTypeOnly ||
				(specifier.type === "ImportSpecifier" && specifier.importKind === "type");
			bindings.set(specifier.local.name, { source, imported, typeOnly });
		}
	}
	return bindings;
}

/** `true` when `source` is `moduleName` itself or a subpath of it — `zod` matches `zod/mini`. */
export function isModuleOrSubpath(source: string, moduleName: string): boolean {
	return source === moduleName || source.startsWith(`${moduleName}/`);
}

/** `true` when `source` is any of `moduleNames`, or a subpath of one. */
export function isFromAnyModule(source: string, moduleNames: readonly string[]): boolean {
	return moduleNames.some((moduleName) => isModuleOrSubpath(source, moduleName));
}

/**
 * Resolve an identifier used in value position to the module export it refers to.
 *
 * Returns `null` for locals, for type-only bindings, and for imports from other modules.
 */
export function resolveValueBinding(
	bindings: ImportBindings,
	name: string,
	moduleNames: readonly string[],
): ImportBinding | null {
	const binding = bindings.get(name);
	if (binding === undefined || binding.typeOnly) return null;
	return isFromAnyModule(binding.source, moduleNames) ? binding : null;
}

/** Resolve a type-position identifier to the module export it refers to. */
export function resolveTypeBinding(
	bindings: ImportBindings,
	name: string,
	moduleNames: readonly string[],
): ImportBinding | null {
	const binding = bindings.get(name);
	if (binding === undefined) return null;
	return isFromAnyModule(binding.source, moduleNames) ? binding : null;
}

/** The statically-known property name of a member expression, or `null` when computed at runtime. */
export function staticMemberName(node: ESTree.MemberExpression): string | null {
	if (node.type !== "MemberExpression") return null;
	if (!node.computed) {
		return node.property.type === "Identifier" ? node.property.name : null;
	}
	const { property } = node;
	return property.type === "Literal" && typeof property.value === "string" ? property.value : null;
}

/**
 * The statically-known key of a property, or `null` for computed keys and non-properties.
 *
 * Accepts any node so the same helper covers object literals, object patterns and assignment
 * targets — all four spell their entries `type: "Property"` with `key` and `computed`.
 */
export function propertyKeyName(node: ESTree.Node): string | null {
	if (node.type !== "Property" || node.computed) return null;
	if (node.key.type === "Identifier") return node.key.name;
	return node.key.type === "Literal" && typeof node.key.value === "string" ? node.key.value : null;
}

/** Look up a property by key in an object literal, ignoring spreads and computed keys. */
export function findProperty(
	node: ESTree.ObjectExpression,
	key: string,
): ESTree.ObjectProperty | null {
	for (const property of node.properties) {
		if (property.type === "Property" && propertyKeyName(property) === key) return property;
	}
	return null;
}

/** Strip parentheses and TS-only wrappers so callers see the underlying expression. */
export function unwrapExpression(node: ESTree.Expression): ESTree.Expression {
	let current = node;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSSatisfiesExpression" ||
		current.type === "TSNonNullExpression"
	) {
		current = current.expression;
	}
	return current;
}

/**
 * The identifier a member/call chain starts from — `z` for both `z.iso.datetime` and
 * `z.object({}).strict().merge`.
 *
 * Steps through call links as well as member links, so an intermediate builder call does not
 * hide the origin of the chain.
 */
export function memberChainRoot(node: ESTree.Expression): ESTree.IdentifierReference | null {
	let current = unwrapExpression(node);
	for (;;) {
		if (current.type === "MemberExpression") {
			current = unwrapExpression(current.object);
			continue;
		}
		if (current.type === "CallExpression") {
			current = unwrapExpression(current.callee);
			continue;
		}
		return current.type === "Identifier" ? current : null;
	}
}

/**
 * Match a reference to a module export, through either import style.
 *
 * Covers `string` (named import) and `z.string` / `ns.string` (member access on any binding
 * imported from the module), returning `true` only when the binding resolves to one of
 * `moduleNames`. Member access is accepted on named imports too, because the dominant Zod and
 * Drizzle idiom is `import { z } from "zod"` — a named export used as a namespace object.
 */
export function isModuleExport(
	node: ESTree.Expression,
	bindings: ImportBindings,
	moduleNames: readonly string[],
	exportName: string,
): boolean {
	const target = unwrapExpression(node);
	if (target.type === "Identifier") {
		return resolveValueBinding(bindings, target.name, moduleNames)?.imported === exportName;
	}
	if (target.type !== "MemberExpression") return false;
	if (staticMemberName(target) !== exportName) return false;
	const object = unwrapExpression(target.object);
	if (object.type !== "Identifier") return false;
	return resolveValueBinding(bindings, object.name, moduleNames) !== null;
}

/** The binding behind `z.…`-style access, or `null` when `node` is not imported from the module. */
export function namespaceBindingOf(
	node: ESTree.Expression,
	bindings: ImportBindings,
	moduleNames: readonly string[],
): ImportBinding | null {
	const object = unwrapExpression(node);
	if (object.type !== "Identifier") return null;
	return resolveValueBinding(bindings, object.name, moduleNames);
}

/** `true` when any top-level import in the file comes from one of `moduleNames`. */
export function importsAnyModule(bindings: ImportBindings, moduleNames: readonly string[]): boolean {
	for (const binding of bindings.values()) {
		if (isFromAnyModule(binding.source, moduleNames)) return true;
	}
	return false;
}

/** `true` when the file opens with the given directive prologue entry (`"use client"`). */
export function hasDirective(program: ESTree.Program, directive: string): boolean {
	for (const statement of program.body) {
		if (statement.type !== "ExpressionStatement") return false;
		if (statement.directive === undefined || statement.directive === null) return false;
		if (statement.directive === directive) return true;
	}
	return false;
}
