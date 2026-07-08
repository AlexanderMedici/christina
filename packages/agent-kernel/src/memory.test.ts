import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "./memory";
import { FileAgentKernelStore } from "./store";

const paths: string[] = [];
afterEach(async () => {
	await Promise.all(
		paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("MemoryService", () => {
	test("requires review before proposed memory is retrieved", async () => {
		const root = await mkdtemp(join(tmpdir(), "damon-memory-"));
		paths.push(root);
		const store = new FileAgentKernelStore(root);
		await store.initialize();
		const service = new MemoryService(store);
		const proposed = await service.propose({
			scope: "project",
			scopeId: "damon",
			kind: "fact",
			text: "Damon uses workspace mode by default",
			sourceSessionId: "session-1",
			confidence: 0.9,
			tags: ["safety", "workspace"],
		});

		expect(await service.search("workspace safety", "damon")).toHaveLength(0);
		await service.setStatus(proposed.id, "active", "owner");
		expect(
			(await service.search("workspace safety", "damon"))[0]?.memory.id,
		).toBe(proposed.id);
	});
});
