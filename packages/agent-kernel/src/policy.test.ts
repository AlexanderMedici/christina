import { describe, expect, test } from "bun:test";
import { DefaultPolicyEngine } from "./policy";

const base = {
	agentId: "developer",
	workspaceId: "workspace-1",
	safetyMode: "workspace" as const,
};

describe("DefaultPolicyEngine", () => {
	const policy = new DefaultPolicyEngine();

	test("allows reversible workspace writes", () => {
		expect(
			policy.evaluate(
				{ ...base, category: "filesystem.write", target: "src/index.ts" },
				"/repo",
			).result,
		).toBe("allow");
	});

	test("denies writes outside the workspace", () => {
		expect(
			policy.evaluate(
				{ ...base, category: "filesystem.write", target: "../secrets.txt" },
				"/repo",
			).result,
		).toBe("deny");
	});

	test("requires approval for publishing commands", () => {
		expect(
			policy.evaluate(
				{ ...base, category: "command.run", command: "git push origin main" },
				"/repo",
			).result,
		).toBe("require_approval");
	});

	test("review mode is read only", () => {
		expect(
			policy.evaluate(
				{
					...base,
					safetyMode: "review",
					category: "filesystem.write",
					target: "a.ts",
				},
				"/repo",
			).result,
		).toBe("deny");
	});
});
