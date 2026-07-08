import { describe, expect, test } from "bun:test";
import { DefaultPolicyEngine } from "./policy";
import { ToolGateway } from "./tools";

describe("ToolGateway", () => {
	test("enforces scopes before executing a tool", async () => {
		let executed = false;
		const gateway = new ToolGateway({
			policy: new DefaultPolicyEngine(),
			requestApproval: async () => {
				throw new Error("approval should not be requested");
			},
		});
		gateway.register({
			id: "file.read",
			version: "1.0.0",
			description: "Read a file",
			requiredScopes: ["filesystem.read"],
			operationCategory: "filesystem.read",
			riskLevel: "low",
			timeoutMs: 1_000,
			maxOutputBytes: 1_000,
			idempotent: true,
			execute: async () => {
				executed = true;
				return "ok";
			},
		});
		const result = await gateway.execute({
			toolId: "file.read",
			toolInput: {},
			context: {
				runId: "run",
				sessionId: "session",
				agentId: "agent",
				workspaceId: "workspace",
				workspaceRoot: "/repo",
				safetyMode: "workspace",
				scopes: [],
			},
		});
		expect(result.status).toBe("denied");
		expect(executed).toBe(false);
	});
});
