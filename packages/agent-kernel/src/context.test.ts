import { describe, expect, test } from "bun:test";
import { ContextEngine } from "./context";

describe("ContextEngine", () => {
	test("keeps high-priority blocks inside the token budget", () => {
		const result = new ContextEngine().build({
			budget: 25,
			reserve: 5,
			blocks: [
				{
					id: "required",
					kind: "system",
					content: "a".repeat(40),
					priority: 100,
				},
				{
					id: "optional",
					kind: "memory",
					content: "b".repeat(80),
					priority: 10,
				},
			],
		});

		expect(result.blocks.map((block) => block.id)).toEqual(["required"]);
		expect(result.omittedBlockIds).toEqual(["optional"]);
		expect(result.estimatedTokens).toBeLessThanOrEqual(20);
	});
});
