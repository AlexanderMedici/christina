import { describe, expect, test } from "bun:test";
import { validateOutput } from "./structured-output";

describe("structured output", () => {
	test("extracts fenced JSON and validates required properties", () => {
		const result = validateOutput("```json\n{\"status\":\"ok\"}\n```", {
			format: "json",
			strict: true,
			schema: {
				type: "object",
				required: ["status"],
				properties: { status: { type: "string", enum: ["ok"] } },
			},
		});
		expect(result?.valid).toBe(true);
		expect(result?.value).toEqual({ status: "ok" });
	});

	test("reports invalid JSON", () => {
		const result = validateOutput("not json", { format: "json", strict: true });
		expect(result?.valid).toBe(false);
	});
});
