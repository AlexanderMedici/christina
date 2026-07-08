import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { EventFactory } from "./events";
import { AgentKernel } from "./kernel";
import type { AgentRuntimeAdapter } from "./runtime";
import { FileAgentKernelStore } from "./store";
import type { AgentEvent, PreparedRun, RuntimeCapabilities, RuntimeHealth } from "./types";

class FakeRuntime implements AgentRuntimeAdapter {
	readonly id = "test";
	readonly capabilities: RuntimeCapabilities = {
		resume: false,
		cancellation: true,
		structuredToolEvents: true,
		nativeApprovals: false,
		streaming: true,
		structuredOutput: true,
	};

	supports(run: PreparedRun): boolean {
		return run.runtimeId === this.id;
	}

	async *start(run: PreparedRun): AsyncIterable<AgentEvent> {
		const events = new EventFactory(run.id);
		yield events.create({ type: "run.started", runtimeId: this.id });
		if (run.metadata?.role === "ORCHESTRATOR") {
			yield events.create({
				type: "assistant.delta",
				text: "Unified CHRISTINA answer with verified caveats.",
			});
		} else {
			const role = String(run.metadata?.specialistAgentId ?? "UNKNOWN");
			const value = {
				summary: `${role} summary`,
				content: `${role} content`,
				confidence: 88,
				claims: [
					{
						text: "claim",
						status: role === "FACT_CHECKER" ? "verified" : "unverified",
					},
				],
				caveats: [],
				sources:
					role === "RESEARCHER" || role === "FACT_CHECKER"
						? [
							{
								title: "Primary source",
								url: "https://example.test",
								publishedAt: "2026-07-01",
								authority: "primary",
							},
						]
						: [],
				issues: [],
				toolCalls:
					role === "TOOL_EXECUTOR"
						? [
							{
								tool: "api_caller",
								parameters: {},
								expectedReturnSchema: { type: "object" },
								timeoutSeconds: 30,
							},
						]
						: [],
			};
			yield events.create({ type: "runtime.structured_output", value });
			yield events.create({ type: "assistant.delta", text: JSON.stringify(value) });
		}
		yield events.create({
			type: "usage.updated",
			usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
		});
		yield events.create({ type: "run.completed", outcome: "success", exitCode: 0 });
	}

	async cancel(): Promise<void> {}

	async healthCheck(): Promise<RuntimeHealth> {
		return { available: true, version: "test" };
	}
}

const complexRequest =
	"Build a Python scraper that queries an API for AI regulation news, cite sources, verify facts, summarize findings, and review security edge cases.";

function allOverrides() {
	return {
		RESEARCHER: "test",
		CODER: "test",
		FACT_CHECKER: "test",
		SUMMARIZER: "test",
		TOOL_EXECUTOR: "test",
		CRITIC: "test",
	};
}

describe("CHRISTINA orchestrator", () => {
	test("routes at most six unique specialists with dependency stages", async () => {
		const root = await mkdtemp(join(tmpdir(), "christina-route-"));
		const kernel = new AgentKernel(new FileAgentKernelStore(root));
		kernel.registerRuntime(new FakeRuntime());
		await kernel.initialize();
		const plan = kernel.orchestrator.route({ request: complexRequest });
		expect(plan.subtasks.map((task) => task.agentId)).toEqual([
			"RESEARCHER",
			"CODER",
			"TOOL_EXECUTOR",
			"FACT_CHECKER",
			"CRITIC",
			"SUMMARIZER",
		]);
		expect(plan.maxSpecialistResponses).toBe(6);
		const summarizer = plan.subtasks.find((task) => task.agentId === "SUMMARIZER");
		expect(summarizer?.dependencies).toHaveLength(5);
	});

	test("executes specialists, synthesizes, and persists confidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "christina-execute-"));
		const kernel = new AgentKernel(new FileAgentKernelStore(root));
		kernel.registerRuntime(new FakeRuntime());
		await kernel.initialize();
		const started = await kernel.orchestrator.start({
			request: complexRequest,
			workspaceId: "workspace",
			cwd: root,
			runtimeOverrides: allOverrides(),
			synthesisRuntimeId: "test",
			specialistTimeoutMs: 5_000,
			synthesisTimeoutMs: 5_000,
		});
		const completed = await kernel.orchestrator.wait(started.id, 10_000);
		expect(completed.status).toBe("completed");
		expect(completed.contributions).toHaveLength(6);
		expect(completed.synthesis).toContain("Unified CHRISTINA answer");
		expect(completed.routingLog).toContain("<details>");
		expect(completed.confidence?.score).toBeGreaterThanOrEqual(70);
		expect((await kernel.store.getOrchestration(started.id))?.status).toBe(
			"completed",
		);
	});
});
