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
		yield events.create({ type: "assistant.delta", text: "done" });
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
});
