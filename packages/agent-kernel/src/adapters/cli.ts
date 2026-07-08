import { spawn, spawnSync } from "node:child_process";
import { EventFactory } from "../events";
import type { AgentRuntimeAdapter } from "../runtime";
import type {
	AgentEvent,
	AgentSafetyMode,
	PreparedRun,
	RuntimeCapabilities,
	RuntimeHealth,
} from "../types";

export interface CliRuntimeConfig {
	id: string;
	binary: string;
	baseArgs?: string[];
	argsBySafety?: Partial<Record<AgentSafetyMode, string[]>>;
	env?: Record<string, string>;
	promptArgs?: (prompt: string) => string[];
	versionArgs?: string[];
	buildLaunch?: (
		run: PreparedRun,
		prompt: string,
	) => { binary: string; args: string[]; env?: Record<string, string> };
}

import { resolveEnvironment, resolveSpawnTarget } from "../process";

async function* lines(
	stream: NodeJS.ReadableStream,
	onChunk?: (chunk: string) => void,
): AsyncGenerator<string> {
	let buffer = "";
	for await (const chunk of stream) {
		const text = Buffer.isBuffer(chunk)
			? chunk.toString("utf8")
			: String(chunk);
		onChunk?.(text);
		buffer += text;
		const pieces = buffer.split(/\r?\n/);
		buffer = pieces.pop() ?? "";
		for (const piece of pieces) if (piece) yield piece;
	}
	if (buffer) yield buffer;
}

export class CliRuntimeAdapter implements AgentRuntimeAdapter {
	readonly id: string;
	readonly capabilities: RuntimeCapabilities = {
		resume: false,
		cancellation: true,
		structuredToolEvents: false,
		nativeApprovals: false,
		streaming: true,
	};
	private readonly processes = new Map<string, ReturnType<typeof spawn>>();
	private readonly cancelledRuns = new Set<string>();

	constructor(private readonly config: CliRuntimeConfig) {
		this.id = config.id;
	}

	supports(run: PreparedRun): boolean {
		return run.runtimeId === this.id;
	}

	async *start(run: PreparedRun): AsyncIterable<AgentEvent> {
		const events = new EventFactory(run.id);
		const prompt = run.context.rendered
			? `${run.context.rendered}\n\n## USER REQUEST\n\n${run.prompt}`
			: run.prompt;
		const launch = this.config.buildLaunch?.(run, prompt);
		const binary = launch?.binary ?? this.config.binary;
		const args = launch?.args ?? [
			...(this.config.baseArgs ?? []),
			...(this.config.argsBySafety?.[run.safetyMode] ?? []),
			...(this.config.promptArgs?.(prompt) ?? [prompt]),
		];
		const target = resolveSpawnTarget(binary, args);
		const started = Date.now();
		const child = spawn(target.executable, target.args, {
			cwd: run.cwd,
			env: {
				...process.env,
				...resolveEnvironment(this.config.env),
				...resolveEnvironment(launch?.env),
				...(run.env ?? {}),
				CHRISTINA_RUN_ID: run.id,
				CHRISTINA_SESSION_ID: run.sessionId,
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
		let notify: (() => void) | undefined;
		let processEnded = false;
		let readersEnded = 0;
		let spawnError: Error | undefined;
		let exitCode: number | null = null;

		const push = (event: AgentEvent) => {
			queue.push(event);
			notify?.();
			notify = undefined;
		};

		void (async () => {
			try {
				for await (const text of lines(child.stdout)) {
					push(events.create({ type: "assistant.delta", text: `${text}\n` }));
				}
			} finally {
				readersEnded += 1;
				notify?.();
			}
		})();
		void (async () => {
			try {
				for await (const text of lines(child.stderr)) {
					push(events.create({ type: "runtime.stderr", text: `${text}\n` }));
				}
			} finally {
				readersEnded += 1;
				notify?.();
			}
		})();

		child.once("error", (error: Error) => {
			spawnError = error;
			processEnded = true;
			notify?.();
		});
		child.once("exit", (code: number | null) => {
			exitCode = code;
			processEnded = true;
			notify?.();
		});

		while (!processEnded || readersEnded < 2 || queue.length > 0) {
			if (queue.length === 0) {
				await new Promise<void>((resolve) => {
					notify = resolve;
				});
			}
			while (queue.length > 0) {
				const event = queue.shift();
				if (event) yield event;
			}
		}

		this.processes.delete(run.id);
		const wasCancelled = this.cancelledRuns.delete(run.id);
		yield events.create({
			type: "usage.updated",
			usage: { durationMs: Date.now() - started },
		});
		if (wasCancelled) {
			yield events.create({
				type: "run.cancelled",
				reason: "Cancelled by user",
			});
			return;
		}
		if (spawnError) {
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
		if (exitCode === 0) {
			yield events.create({
				type: "run.completed",
				outcome: "success",
				exitCode: 0,
			});
		} else {
			yield events.create({
				type: "run.failed",
				error: {
					code: "runtime_exit_nonzero",
					message: `${binary} exited with code ${exitCode ?? "unknown"}`,
					retryable: true,
				},
			});
		}
	}

	async cancel(runId: string): Promise<void> {
		const child = this.processes.get(runId);
		if (!child) return;
		this.cancelledRuns.add(runId);
		if (process.platform === "win32") {
			spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
				windowsHide: true,
			});
		} else {
			child.kill("SIGTERM");
		}
	}

	async healthCheck(): Promise<RuntimeHealth> {
		const target = resolveSpawnTarget(
			this.config.binary,
			this.config.versionArgs ?? ["--version"],
		);
		const result = spawnSync(target.executable, target.args, {
			encoding: "utf8",
			windowsHide: true,
			timeout: 5_000,
		});
		if (result.error) {
			return { available: false, detail: result.error.message };
		}
		return {
			available: result.status === 0,
			version: String(result.stdout || result.stderr || "").trim() || undefined,
			detail: result.status === 0 ? undefined : `Exited with ${result.status}`,
		};
	}
}
