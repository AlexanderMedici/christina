import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchedulerService } from "./scheduler";
import { FileAgentKernelStore } from "./store";

const paths: string[] = [];

afterEach(async () => {
	await Promise.all(
		paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("SchedulerService", () => {
	test("creates and dispatches one-time schedules", async () => {
		const root = await mkdtemp(join(tmpdir(), "christina-scheduler-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		await store.initialize();
		const scheduler = new SchedulerService(store);
		const schedule = await scheduler.create({
			agentId: "LOCAL_ASSISTANT",
			runtimeId: "fake",
			workspaceId: "workspace-1",
			cwd: root,
			prompt: "Run a daily summary",
			trigger: { type: "once", runAt: new Date(Date.now() - 1_000).toISOString() },
		});

		const results = await scheduler.dispatchDue(async () => ({ runId: "run-1" }));
		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("dispatched");

		const updated = await store.getSchedule(schedule.id);
		expect(updated?.status).toBe("completed");
		expect(updated?.lastRunId).toBe("run-1");
		expect(updated?.nextRunAt).toBeUndefined();
	});

	test("reschedules interval schedules after dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "christina-scheduler-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		await store.initialize();
		const scheduler = new SchedulerService(store);
		const schedule = await scheduler.create({
			agentId: "LOCAL_ASSISTANT",
			runtimeId: "fake",
			workspaceId: "workspace-1",
			cwd: root,
			prompt: "Check project status",
			trigger: { type: "interval", everyMinutes: 15 },
		});

		const dispatchedAt = new Date("2026-07-08T12:00:00.000Z");
		await store.putSchedule({ ...schedule, nextRunAt: dispatchedAt.toISOString() });
		const results = await scheduler.dispatchDue(
			async () => ({ runId: "run-2" }),
			dispatchedAt,
		);

		expect(results[0]?.status).toBe("dispatched");
		const updated = await store.getSchedule(schedule.id);
		expect(updated?.status).toBe("active");
		expect(updated?.lastRunId).toBe("run-2");
		expect(updated?.nextRunAt).toBe("2026-07-08T12:15:00.000Z");
	});
});
