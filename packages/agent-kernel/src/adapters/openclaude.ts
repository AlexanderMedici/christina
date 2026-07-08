import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventFactory } from "../events";
import { resolveEnvironment, resolveSpawnTarget } from "../process";
import type { AgentRuntimeAdapter } from "../runtime";
import type {
	AgentEvent,
	PreparedRun,
	RuntimeCapabilities,
	RuntimeHealth,
	ToolCall,
	ToolResult,
} from "../types";

interface OpenClaudeAdapterConfig {
	id?: string;
	binary?: string;
	baseArgs?: string[];
	env?: Record<string, string>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function contentBlocks(message: unknown): unknown[] {
	if (!isObject(message)) return [];
	const content = message.content;
	return Array.isArray(content) ? content : [];
}

export interface OpenClaudeParseState {
	sawAssistantText: boolean;
	runtimeSessionId?: string;
}

/** Maps one OpenClaude stream-json record into CHRISTINA-normalized events. */
export function parseOpenClaudeMessage(
	message: unknown,
	events: EventFactory,
	state: OpenClaudeParseState,
	runtimeId = "openclaude",
): AgentEvent[] {
	if (!isObject(message)) return [];
	const output: AgentEvent[] = [];
	const type = stringValue(message.type);
	const sessionId = stringValue(message.session_id);
	if (sessionId && sessionId !== state.runtimeSessionId) {
		state.runtimeSessionId = sessionId;
		output.push(
			events.create({
				type: "runtime.session",
				runtimeId,
				runtimeSessionId: sessionId,
			}),
		);
	}

	if (type === "streamlined_text") {
		const text = stringValue(message.text) ?? stringValue(message.content);
		if (text) {
			state.sawAssistantText = true;
			output.push(events.create({ type: "assistant.delta", text }));
		}
		return output;
	}

	if (type === "assistant") {
		for (const block of contentBlocks(message.message)) {
			if (!isObject(block)) continue;
			if (block.type === "text" && typeof block.text === "string") {
				state.sawAssistantText = true;
				output.push(
					events.create({ type: "assistant.delta", text: block.text }),
				);
			}
			if (block.type === "tool_use") {
				const call: ToolCall = {
					id: stringValue(block.id) ?? randomUUID(),
					toolId: stringValue(block.name) ?? "unknown",
					input: block.input,
				};
				output.push(events.create({ type: "tool.requested", call }));
			}
		}
		return output;
	}

	if (type === "user") {
		for (const block of contentBlocks(message.message)) {
			if (!isObject(block) || block.type !== "tool_result") continue;
			const result: ToolResult = {
				callId: stringValue(block.tool_use_id) ?? "unknown",
				output: block.content,
				error: block.is_error === true ? String(block.content ?? "Tool failed") : undefined,
			};
			output.push(events.create({ type: "tool.completed", result }));
		}
		return output;
	}

	if (type === "control_request") {
		const request = isObject(message.request) ? message.request : undefined;
		if (request?.subtype === "can_use_tool") {
			output.push(
				events.create({
					type: "permission.requested",
					request: {
						id: stringValue(message.request_id) ?? randomUUID(),
						operation: {
							agentId: "openclaude",
							workspaceId: "runtime",
							safetyMode: "workspace",
							category: "other",
							target: stringValue(request.tool_name),
							metadata: { runtimeRequest: request },
						},
						reason: `OpenClaude requested permission for ${stringValue(request.tool_name) ?? "a tool"}.`,
						requestedAt: new Date().toISOString(),
					},
				}),
			);
		}
		return output;
	}

	if (type !== "result") return output;

	const usage = isObject(message.usage) ? message.usage : {};
	output.push(
		events.create({
			type: "usage.updated",
			usage: {
				inputTokens:
					numberValue(usage.input_tokens) ?? numberValue(usage.inputTokens),
				outputTokens:
					numberValue(usage.output_tokens) ?? numberValue(usage.outputTokens),
				cachedTokens:
					numberValue(usage.cache_read_input_tokens) ??
					numberValue(usage.cached_tokens),
				costUsd: numberValue(message.total_cost_usd),
				durationMs: numberValue(message.duration_ms),
			},
		}),
	);
	const turns = numberValue(message.num_turns);
	if (turns !== undefined) {
		output.push(events.create({ type: "turn.completed", turn: turns }));
	}
	if (message.structured_output !== undefined) {
		output.push(
			events.create({
				type: "runtime.structured_output",
				value: message.structured_output,
			}),
		);
	}
	const resultText = stringValue(message.result);
	if (!state.sawAssistantText && resultText && message.structured_output === undefined) {
		state.sawAssistantText = true;
		output.push(events.create({ type: "assistant.delta", text: resultText }));
	}

	if (message.subtype === "success" && message.is_error !== true) {
		output.push(events.create({ type: "run.completed", outcome: "success" }));
		return output;
	}

	const subtype = stringValue(message.subtype) ?? "error_during_execution";
	const code =
		subtype === "error_max_budget_usd"
			? "budget_exceeded"
			: subtype === "error_max_turns"
				? "max_turns_exceeded"
				: subtype === "error_max_structured_output_retries"
					? "structured_output_retries_exceeded"
					: "runtime_execution_failed";
	output.push(
		events.create({
			type: "run.failed",
			error: {
				code,
				message: resultText || `OpenClaude ended with ${subtype}.`,
				retryable: subtype !== "error_max_budget_usd",
				detail: JSON.stringify(message),
			},
		}),
	);
	return output;
}

async function* lineStream(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
	let buffer = "";
	for await (const chunk of stream) {
		buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) if (line.trim()) yield line;
	}
	if (buffer.trim()) yield buffer;
}

export class OpenClaudeRuntimeAdapter implements AgentRuntimeAdapter {
	readonly id: string;
	readonly capabilities: RuntimeCapabilities = {
		resume: true,
		cancellation: true,
		structuredToolEvents: true,
		nativeApprovals: true,
		streaming: true,
		structuredOutput: true,
		checkpoints: true,
	};
	private readonly binary: string;
	private readonly baseArgs: string[];
	private readonly env?: Record<string, string>;
	private readonly processes = new Map<string, ReturnType<typeof spawn>>();
	private readonly cancelledRuns = new Set<string>();

	constructor(config: OpenClaudeAdapterConfig = {}) {
		this.id = config.id ?? "openclaude";
		this.binary = config.binary ?? "openclaude";
		this.baseArgs = config.baseArgs ?? [
			"--print",
			"--output-format",
			"stream-json",
			"--verbose",
		];
		this.env = config.env;
	}

	supports(run: PreparedRun): boolean {
		return run.runtimeId === this.id;
	}

	start(run: PreparedRun): AsyncIterable<AgentEvent> {
		return this.execute(run);
	}

	resume(runtimeSessionId: string, run: PreparedRun): AsyncIterable<AgentEvent> {
		return this.execute(run, runtimeSessionId);
	}

	private async *execute(
		run: PreparedRun,
		resumeSessionId?: string,
	): AsyncIterable<AgentEvent> {
		const events = new EventFactory(run.id);
		const fullPrompt = run.context.rendered
			? `${run.context.rendered}\n\n## USER REQUEST\n\n${run.prompt}`
			: run.prompt;
		const safetyArgs =
			run.safetyMode === "review"
				? ["--permission-mode", "plan"]
				: run.safetyMode === "unrestricted"
					? [
							"--permission-mode",
							"bypassPermissions",
							"--dangerously-skip-permissions",
						]
					: ["--permission-mode", "acceptEdits"];
		const args = [
			...this.baseArgs,
			...safetyArgs,
			...(run.model ? ["--model", run.model] : []),
			...(run.budget?.maxTurns !== undefined
				? ["--max-turns", String(run.budget.maxTurns)]
				: []),
			...(run.budget?.maxCostUsd !== undefined
				? ["--max-budget-usd", String(run.budget.maxCostUsd)]
				: []),
			...(run.outputContract?.format === "json" && run.outputContract.schema
				? ["--json-schema", JSON.stringify(run.outputContract.schema)]
				: []),
			...(resumeSessionId ? ["--resume", resumeSessionId] : []),
			fullPrompt,
		];
		const target = resolveSpawnTarget(this.binary, args);
		const child = spawn(target.executable, target.args, {
			cwd: run.cwd,
			env: {
				...process.env,
				...resolveEnvironment(this.env),
				...resolveEnvironment(run.env),
				ADE_RUN_ID: run.id,
				ADE_SESSION_ID: run.sessionId,
			},
			shell: false,
			windowsHide: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.processes.set(run.id, child);
		yield events.create({ type: "run.started", runtimeId: this.id });

		const queue: AgentEvent[] = [];
		let wake: (() => void) | undefined;
		let readersEnded = 0;
		let processEnded = false;
		let exitCode: number | null = null;
		let spawnError: Error | undefined;
		let terminalSeen = false;
		const state: OpenClaudeParseState = { sawAssistantText: false };
		const push = (event: AgentEvent) => {
			if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
				terminalSeen = true;
			}
			queue.push(event);
			wake?.();
			wake = undefined;
		};

		void (async () => {
			try {
				for await (const line of lineStream(child.stdout)) {
					try {
						for (const event of parseOpenClaudeMessage(JSON.parse(line), events, state, this.id)) {
							push(event);
						}
					} catch (error) {
						push(
							events.create({
								type: "runtime.stderr",
								text: `Invalid OpenClaude stream record: ${error instanceof Error ? error.message : String(error)}\n`,
							}),
						);
					}
				}
			} finally {
				readersEnded += 1;
				wake?.();
			}
		})();
		void (async () => {
			try {
				for await (const line of lineStream(child.stderr)) {
					push(events.create({ type: "runtime.stderr", text: `${line}\n` }));
				}
			} finally {
				readersEnded += 1;
				wake?.();
			}
		})();

		child.once("error", (error) => {
			spawnError = error;
			processEnded = true;
			wake?.();
		});
		child.once("exit", (code) => {
			exitCode = code;
			processEnded = true;
			wake?.();
		});

		while (!processEnded || readersEnded < 2 || queue.length > 0) {
			if (queue.length === 0) {
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
			}
			while (queue.length > 0) {
				const event = queue.shift();
				if (event) yield event;
			}
		}

		this.processes.delete(run.id);
		if (this.cancelledRuns.delete(run.id) && !terminalSeen) {
			yield events.create({ type: "run.cancelled", reason: "Cancelled by user" });
			return;
		}
		if (spawnError && !terminalSeen) {
			yield events.create({
				type: "run.failed",
				error: {
					code: "runtime_spawn_failed",
					message: spawnError.message,
					retryable: true,
				},
			});
			return;
		}
		if (!terminalSeen) {
			yield events.create({
				type: exitCode === 0 ? "run.completed" : "run.failed",
				...(exitCode === 0
					? { outcome: "success" as const, exitCode: exitCode ?? undefined }
					: {
							error: {
								code: "runtime_exit_nonzero",
								message: `OpenClaude exited with code ${exitCode ?? "unknown"}.`,
								retryable: true,
							},
						}),
			} as Parameters<EventFactory["create"]>[0]);
		}
	}

	async cancel(runId: string): Promise<void> {
		const child = this.processes.get(runId);
		if (!child || child.pid === undefined) return;
		this.cancelledRuns.add(runId);
		if (process.platform === "win32") {
			spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
				shell: false,
				windowsHide: true,
			});
		} else {
			child.kill("SIGTERM");
		}
	}

	async healthCheck(): Promise<RuntimeHealth> {
		const started = Date.now();
		return new Promise((resolve) => {
			const target = resolveSpawnTarget(this.binary, ["--version"]);
			const child = spawn(target.executable, target.args, {
				shell: false,
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			child.stdout.on("data", (chunk) => {
				output += String(chunk);
			});
			child.once("error", (error) =>
				resolve({
					available: false,
					detail: error.message,
					latencyMs: Date.now() - started,
				}),
			);
			child.once("exit", (code) =>
				resolve({
					available: code === 0,
					version: code === 0 ? output.trim() || undefined : undefined,
					detail: code === 0 ? undefined : `OpenClaude exited with code ${code}.`,
					latencyMs: Date.now() - started,
				}),
			);
		});
	}
}
