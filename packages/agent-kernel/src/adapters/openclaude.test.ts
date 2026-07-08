import { describe, expect, test } from "bun:test";
import { EventFactory } from "../events";
import { parseOpenClaudeMessage } from "./openclaude";

describe("OpenClaude stream adapter", () => {
	test("normalizes sessions, assistant text, tool calls, and usage", () => {
		const factory = new EventFactory("run-1");
		const state = { sawAssistantText: false };
		const assistant = parseOpenClaudeMessage(
			{
				type: "assistant",
				session_id: "oc-session",
				message: {
					content: [
						{ type: "text", text: "Working" },
						{ type: "tool_use", id: "call-1", name: "Read", input: { path: "a.ts" } },
					],
				},
			},
			factory,
			state,
		);
		expect(assistant.map((event) => event.type)).toEqual([
			"runtime.session",
			"assistant.delta",
			"tool.requested",
		]);

		const result = parseOpenClaudeMessage(
			{
				type: "result",
				subtype: "success",
				is_error: false,
				session_id: "oc-session",
				duration_ms: 50,
				num_turns: 2,
				total_cost_usd: 0.01,
				usage: { input_tokens: 10, output_tokens: 4 },
				result: "Working",
				structured_output: { status: "ok" },
			},
			factory,
			state,
		);
		expect(result.map((event) => event.type)).toEqual([
			"usage.updated",
			"turn.completed",
			"run.completed",
		]);
	});

	test("maps native budget failures", () => {
		const events = parseOpenClaudeMessage(
			{
				type: "result",
				subtype: "error_max_budget_usd",
				is_error: true,
				result: "Budget reached",
			},
			new EventFactory("run-2"),
			{ sawAssistantText: false },
		);
		const failure = events.find((event) => event.type === "run.failed");
		expect(failure?.type).toBe("run.failed");
		if (failure?.type === "run.failed") {
			expect(failure.error.code).toBe("budget_exceeded");
		}
	});
});
