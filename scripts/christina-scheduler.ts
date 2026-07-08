import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	AgentKernel,
	FileAgentKernelStore,
	OllamaRuntimeAdapter,
	OpenAICompatibleRuntimeAdapter,
} from "../packages/agent-kernel/src/index";

interface Options {
	command: string;
	values: Map<string, string>;
}

function parseArgs(argv: string[]): Options {
	const command = argv[0] ?? "help";
	const values = new Map<string, string>();
	for (let index = 1; index < argv.length; index += 1) {
		const item = argv[index];
		if (!item?.startsWith("--")) continue;
		const value = argv[index + 1];
		if (value && !value.startsWith("--")) {
			values.set(item.slice(2), value);
			index += 1;
		} else {
			values.set(item.slice(2), "true");
		}
	}
	return { command, values };
}

function required(values: Map<string, string>, key: string): string {
	const value = values.get(key)?.trim();
	if (!value) throw new Error(`Missing required option --${key}`);
	return value;
}

function registerLocalProviders(kernel: AgentKernel): void {
	kernel.registerLocalModelProvider(
		new OllamaRuntimeAdapter({
			baseUrl: process.env.CHRISTINA_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
			timeoutMs: Number(process.env.CHRISTINA_LOCAL_MODEL_TIMEOUT_MS ?? 120_000),
		}),
	);
	kernel.registerLocalModelProvider(
		new OpenAICompatibleRuntimeAdapter({
			id: "lmstudio",
			label: "LM Studio",
			kind: "openai-compatible",
			baseUrl: process.env.CHRISTINA_LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
			apiKey: process.env.CHRISTINA_LMSTUDIO_API_KEY,
			timeoutMs: Number(process.env.CHRISTINA_LOCAL_MODEL_TIMEOUT_MS ?? 120_000),
		}),
	);
	if (process.env.CHRISTINA_LOCAL_OPENAI_BASE_URL) {
		kernel.registerLocalModelProvider(
			new OpenAICompatibleRuntimeAdapter({
				id: "local-openai",
				label: "Local OpenAI-Compatible Server",
				kind: "openai-compatible",
				baseUrl: process.env.CHRISTINA_LOCAL_OPENAI_BASE_URL,
				apiKey: process.env.CHRISTINA_LOCAL_OPENAI_API_KEY,
				timeoutMs: Number(process.env.CHRISTINA_LOCAL_MODEL_TIMEOUT_MS ?? 120_000),
				trustedLocalhostOnly:
					process.env.CHRISTINA_ALLOW_REMOTE_MODEL_ENDPOINT === "true" ? false : true,
			}),
		);
	}
}

async function createKernel(): Promise<AgentKernel> {
	const home = process.env.CHRISTINA_HOME ?? join(homedir(), ".christina");
	const kernel = new AgentKernel(new FileAgentKernelStore(join(home, "agent-kernel")));
	registerLocalProviders(kernel);
	await kernel.initialize();
	return kernel;
}

function printHelp(): void {
	console.log(`CHRISTINA scheduler CLI

Commands:
  add --agent AGENT_ID --runtime RUNTIME_ID --workspace WORKSPACE_ID --prompt "..." [--cwd PATH]
      [--model MODEL] [--at 2026-07-09T13:00:00Z | --every-minutes 60]

  list
      List saved schedules.

  run-due
      Dispatch all due schedules immediately.

  pause --schedule SCHEDULE_ID
  resume --schedule SCHEDULE_ID
  remove --schedule SCHEDULE_ID

Notes:
  - Use --at for one-time schedules in ISO-8601 format.
  - Use --every-minutes for recurring schedules.
  - The scheduler stores durable definitions. Trigger execution by running
    \`pnpm schedule:run-due\` from Task Scheduler, cron, or another host runner.
`);
}

async function main(): Promise<void> {
	const { command, values } = parseArgs(process.argv.slice(2));
	if (["help", "--help", "-h"].includes(command)) {
		printHelp();
		return;
	}
	const kernel = await createKernel();

	if (command === "add") {
		const at = values.get("at");
		const everyMinutesRaw = values.get("every-minutes");
		if (!at && !everyMinutesRaw) {
			throw new Error("Provide either --at or --every-minutes.");
		}
		if (at && everyMinutesRaw) {
			throw new Error("Use either --at or --every-minutes, not both.");
		}
		const trigger = at
			? { type: "once" as const, runAt: new Date(at).toISOString() }
			: { type: "interval" as const, everyMinutes: Number(everyMinutesRaw) };
		if (trigger.type === "interval" && (!Number.isFinite(trigger.everyMinutes) || trigger.everyMinutes <= 0)) {
			throw new Error("--every-minutes must be a positive number.");
		}
		console.log(
			JSON.stringify(
				await kernel.scheduler.create({
					agentId: required(values, "agent"),
					runtimeId: required(values, "runtime"),
					workspaceId: required(values, "workspace"),
					cwd: resolve(values.get("cwd") ?? process.cwd()),
					prompt: required(values, "prompt"),
					safetyMode: values.get("safety-mode") === "review" ? "review" : "workspace",
					model: values.get("model"),
					trigger,
				}),
				null,
				2,
			),
		);
		return;
	}

	if (command === "list") {
		console.log(JSON.stringify(await kernel.scheduler.list(), null, 2));
		return;
	}

	if (command === "run-due") {
		console.log(JSON.stringify(await kernel.dispatchDueSchedules(), null, 2));
		return;
	}

	if (command === "pause") {
		console.log(JSON.stringify(await kernel.scheduler.pause(required(values, "schedule")), null, 2));
		return;
	}

	if (command === "resume") {
		console.log(JSON.stringify(await kernel.scheduler.resume(required(values, "schedule")), null, 2));
		return;
	}

	if (command === "remove") {
		await kernel.scheduler.delete(required(values, "schedule"));
		console.log("Schedule removed.");
		return;
	}

	throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
