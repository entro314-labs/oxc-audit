import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const commentOwnerKinds = new Set([
	"ExpressionStatement",
	"PropertyDefinition",
	"ReturnStatement",
	"ThrowStatement",
	"VariableDeclaration",
]);

function isConstAssertion(node: TypeAssertion): boolean {
	return (
		node.typeAnnotation.type === "TSTypeReference" &&
		node.typeAnnotation.typeName.type === "Identifier" &&
		node.typeAnnotation.typeName.name === "const"
	);
}

/**
 * `true` when another assertion encloses this one, as in `x as unknown as User`.
 *
 * A chain shares one source position and one justification, so only its outermost link is
 * reported — otherwise every laundering chain raises a duplicate diagnostic at the same
 * column.
 */
function isNestedInAssertion(node: TypeAssertion): boolean {
	let current: ESTree.Node = node;
	let { parent } = node;
	while (parent.type === "ParenthesizedExpression" && parent.expression === current) {
		current = parent;
		({ parent } = parent);
	}
	return (
		(parent.type === "TSAsExpression" || parent.type === "TSTypeAssertion") &&
		parent.expression === current
	);
}

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
	let current: ESTree.Node = node;
	while (true) {
		if (
			sourceCode
				.getCommentsBefore(current)
				.some((comment) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value))
		) {
			return true;
		}
		if (commentOwnerKinds.has(current.type) || current.parent.type === "Program") return false;
		current = current.parent;
	}
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.",
		},
		messages: {
			missingSafetyComment:
				"This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.",
		},
	},
	create(context) {
		const checkAssertion = (node: TypeAssertion) => {
			if (isConstAssertion(node) || isNestedInAssertion(node)) return;
			if (hasSafetyComment(context.sourceCode, node)) return;
			context.report({ node, messageId: "missingSafetyComment" });
		};

		return {
			TSAsExpression: checkAssertion,
			TSTypeAssertion: checkAssertion,
		};
	},
});
