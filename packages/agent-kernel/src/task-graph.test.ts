import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAgentKernelStore } from "./store";
import { TaskGraphService } from "./task-graph";

const paths: string[] = [];
afterEach(async () => {
	await Promise.all(
		paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("TaskGraphService", () => {
	test("unblocks dependent tasks after prerequisites complete", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-graph-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		await store.initialize();
		const graph = new TaskGraphService(store);
		const tasks = await graph.create({
			tasks: [
				{ key: "plan", title: "Plan" },
				{ key: "build", title: "Build", dependencies: ["plan"] },
			],
		});
		const plan = tasks.find((task) => task.key === "plan");
		if (!plan) throw new Error("Missing plan task");
		expect((await graph.ready(plan.graphId)).map((task) => task.key)).toEqual([
			"plan",
		]);
		await graph.update(plan.id, "running");
		await graph.update(plan.id, "completed");
		expect((await graph.ready(plan.graphId)).map((task) => task.key)).toEqual([
			"build",
		]);
	});
});
