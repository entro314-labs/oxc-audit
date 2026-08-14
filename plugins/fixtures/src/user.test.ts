import { describe, it, expect, vi } from "vitest";
import type { ErrorWithDiff } from "vitest";

describe("user", () => {
	vi.mock("./db");
	it("loads", async () => {
		expect(load()).resolves.toBe(1);
	});
});
