import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventFactory } from "./events";
import { FileAgentKernelStore } from "./store";

const paths: string[] = [];
afterEach(async () => {
	await Promise.all(
		paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("FileAgentKernelStore", () => {
	test("persists sessions and ordered run events", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-kernel-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		await store.initialize();
		const now = new Date().toISOString();
		await store.putSession({
			id: "session-1",
			agentId: "developer",
			workspaceId: "workspace-1",
			runtimeSessionIds: {},
			status: "active",
			createdAt: now,
			lastActiveAt: now,
		});
		const factory = new EventFactory("run-1");
		await store.appendEvent(
			factory.create({ type: "run.started", runtimeId: "fake" }),
		);
		await store.appendEvent(
			factory.create({
				type: "run.completed",
				outcome: "success",
				exitCode: 0,
			}),
		);

		expect((await store.getSession("session-1"))?.agentId).toBe("developer");
		expect(
			(await store.listEvents("run-1")).map((event) => event.sequence),
		).toEqual([1, 2]);
	});
});
