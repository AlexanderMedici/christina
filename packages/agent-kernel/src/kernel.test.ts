import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventFactory } from "./events";
import { AgentKernel } from "./kernel";
import type { AgentRuntimeAdapter } from "./runtime";
import { FileAgentKernelStore } from "./store";
import type { AgentEvent, PreparedRun } from "./types";

const paths: string[] = [];
afterEach(async () => {
	await Promise.all(
		paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

class FakeRuntime implements AgentRuntimeAdapter {
	id = "fake";
	capabilities = {
		resume: false,
		cancellation: true,
		structuredToolEvents: true,
		nativeApprovals: true,
		streaming: true,
	};

	supports(run: PreparedRun) {
		return run.runtimeId === this.id;
	}

	async *start(run: PreparedRun): AsyncIterable<AgentEvent> {
		const events = new EventFactory(run.id);
		yield events.create({ type: "run.started", runtimeId: this.id });
		yield events.create({
			type: "assistant.delta",
			text: "done with a reusable validation procedure that reviews the workspace, checks risky changes, verifies outputs, records important caveats, and leaves enough detail behind for future runs to reuse the same flow without rediscovering it from scratch.",
		});
		yield events.create({
			type: "run.completed",
			outcome: "success",
			exitCode: 0,
		});
	}

	async cancel() {}
	async healthCheck() {
		return { available: true };
	}
}

describe("AgentKernel", () => {
	test("owns the durable session, run, and event history", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-run-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		const kernel = new AgentKernel(store);
		kernel.registerRuntime(new FakeRuntime());
		await kernel.initialize();
		const run = await kernel.start({
			agentId: "developer",
			runtimeId: "fake",
			workspaceId: "workspace-1",
			cwd: root,
			prompt: "Test the kernel",
		});

		for (let i = 0; i < 50 && kernel.isActive(run.id); i += 1) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		expect((await store.getRun(run.id))?.status).toBe("completed");
		expect((await store.listEvents(run.id)).map((event) => event.type)).toEqual(
			["run.started", "assistant.delta", "run.completed"],
		);
	});

	test("dispatches due schedules through the kernel runtime", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-run-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		const kernel = new AgentKernel(store);
		kernel.registerRuntime(new FakeRuntime());
		await kernel.initialize();
		const schedule = await kernel.scheduler.create({
			agentId: "developer",
			runtimeId: "fake",
			workspaceId: "workspace-1",
			cwd: root,
			prompt: "Scheduled test run",
			trigger: { type: "once", runAt: new Date(Date.now() - 1_000).toISOString() },
		});

		const results = await kernel.dispatchDueSchedules();
		expect(results[0]?.status).toBe("dispatched");

		const runId = results[0]?.runId;
		expect(runId).toBeTruthy();
		if (!runId) throw new Error("Expected dispatched run id");
		await kernel.waitForRun(runId, 1_000);

		expect((await store.getRun(runId))?.status).toBe("completed");
		expect((await store.getSchedule(schedule.id))?.status).toBe("completed");
	});

	test("recalls approved memory and active skills into run context", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-run-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		const kernel = new AgentKernel(store);
		kernel.registerRuntime(new FakeRuntime());
		await kernel.initialize();
		const memory = await kernel.memory.propose({
			scope: "project",
			scopeId: "workspace-1",
			kind: "fact",
			text: "Use workspace mode and validate repo changes before finalizing.",
			sourceSessionId: "seed-session",
			confidence: 0.95,
			tags: ["workspace", "validation"],
		});
		await kernel.memory.setStatus(memory.id, "active", "owner");
		const skill = await kernel.skills.create({
			name: "Validate repo changes",
			version: "1.0.0",
			description: "Validation steps for repository changes",
			instructions: "Run checks and summarize any missing verification.",
			triggers: ["validate", "repo", "changes"],
			requiredTools: [],
			status: "active",
		});
		const started = await kernel.start({
			agentId: "developer",
			runtimeId: "fake",
			workspaceId: "workspace-1",
			cwd: root,
			prompt: "Validate repo changes before finalizing",
		});
		await kernel.waitForRun(started.id, 1_000);
		const run = await store.getRun(started.id);
		expect(run?.preparedRun.context.blocks.some((block) => block.kind === "memory")).toBe(
			true,
		);
		expect(
			run?.preparedRun.context.blocks.some(
				(block) => block.kind === "skill" && block.id === `skill-${skill.id}`,
			),
		).toBe(true);
	});

	test("auto-drafts a skill from a successful run", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-run-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		const kernel = new AgentKernel(store);
		kernel.registerRuntime(new FakeRuntime());
		await kernel.initialize();
		const longPrompt =
			"Implement a robust repository validation workflow and explain each verification step in detail for future reuse";
		const started = await kernel.start({
			agentId: "developer",
			runtimeId: "fake",
			workspaceId: "workspace-1",
			cwd: root,
			prompt: longPrompt,
		});
		await kernel.waitForRun(started.id, 1_000);
		const drafted = (await kernel.skills.list()).find(
			(entry) => entry.name === "Implement a robust repository validation workflow and explain",
		);
		expect(drafted?.status).toBe("draft");
		expect(drafted?.instructions).toContain("Reference output:");
	});

	test("dispatches ready task-graph tasks through runtimes", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-run-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		const kernel = new AgentKernel(store);
		kernel.registerRuntime(new FakeRuntime());
		await kernel.initialize();
		const tasks = await kernel.tasks.create({
			tasks: [
				{
					key: "plan",
					title: "Plan the change",
					description: "Plan the repository change in concrete steps",
					assignedAgentId: "planner",
					runtimeId: "fake",
				},
				{
					key: "build",
					title: "Build the change",
					description: "Implement the planned repository change",
					dependencies: ["plan"],
					assignedAgentId: "builder",
					runtimeId: "fake",
				},
			],
		});
		const graphId = tasks[0]?.graphId;
		if (!graphId) throw new Error("Expected graph id");
		const firstPass = await kernel.dispatchTaskGraph({
			graphId,
			workspaceId: "workspace-1",
			cwd: root,
		});
		expect(firstPass.dispatched).toHaveLength(2);
		expect(firstPass.dispatched.every((entry) => entry.status === "completed")).toBe(true);
		expect((await kernel.tasks.ready(graphId)).map((task) => task.key)).toEqual([]);
	});
});
