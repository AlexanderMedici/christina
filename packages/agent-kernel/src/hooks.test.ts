import { describe, expect, test } from "bun:test";
import { HookEngine } from "./hooks";

describe("hook engine", () => {
	test("orders hooks and allows input transformation", async () => {
		const hooks = new HookEngine();
		hooks.register(
			{
				id: "append-policy",
				name: "Append policy",
				events: ["run.before"],
				priority: 10,
				enabled: true,
				timeoutMs: 1_000,
				kind: "callback",
			},
			async () => ({ updatedInput: { prompt: "updated" }, additionalContext: "policy" }),
		);
		const result = await hooks.execute({ event: "run.before", payload: { prompt: "original" } });
		expect(result.updatedInput).toEqual({ prompt: "updated" });
		expect(result.additionalContexts).toEqual(["policy"]);
	});
});
