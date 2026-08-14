interface User {
	id: number;
}

// slop-stop/no-chained-type-assertions
export const laundered = payload as unknown as User;

// slop-stop/no-widen-then-assert
const widened: unknown = { id: 1 };
export const narrowed = widened as User;

// slop-stop/no-known-value-widening
export const settings: Record<string, unknown> = { retries: 3 };

// slop-stop/no-unsafe-dictionary-type
export function apply(options: Record<string, unknown>): void {
	void options;
}

// slop-stop/require-safety-comment-for-type-assertion fires on every assertion above.
declare const payload: string;
