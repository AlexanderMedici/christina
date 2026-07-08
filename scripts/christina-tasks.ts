import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	AgentKernel,
	FileAgentKernelStore,
	OllamaRuntimeAdapter,
	OpenAICompatibleRuntimeAdapter,
	type TaskGraphInput,
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
}

async function createKernel(): Promise<AgentKernel> {
	const home = process.env.CHRISTINA_HOME ?? join(homedir(), ".christina");
	const kernel = new AgentKernel(new FileAgentKernelStore(join(home, "agent-kernel")));
	registerLocalProviders(kernel);
	await kernel.initialize();
	return kernel;
}

function printHelp(): void {
	console.log(`CHRISTINA task-graph CLI

Commands:
  create --file tasks.json
      Create a task graph from a JSON file matching TaskGraphInput.

  list [--graph GRAPH_ID]
      List stored tasks.

  run --graph GRAPH_ID --workspace WORKSPACE_ID [--cwd PATH] [--runtime RUNTIME_ID] [--agent AGENT_ID]
      Dispatch ready tasks and wait for their runs to settle.
`);
}

async function main(): Promise<void> {
	const { command, values } = parseArgs(process.argv.slice(2));
	if (["help", "--help", "-h"].includes(command)) {
		printHelp();
		return;
	}
	const kernel = await createKernel();

	if (command === "create") {
		const filePath = resolve(required(values, "file"));
		const raw = await readFile(filePath, "utf8");
		const input = JSON.parse(raw) as TaskGraphInput;
		console.log(JSON.stringify(await kernel.tasks.create(input), null, 2));
		return;
	}

	if (command === "list") {
		console.log(JSON.stringify(await kernel.tasks.listTasks(values.get("graph")), null, 2));
		return;
	}

	if (command === "run") {
		console.log(
			JSON.stringify(
				await kernel.dispatchTaskGraph({
					graphId: required(values, "graph"),
					workspaceId: required(values, "workspace"),
					cwd: resolve(values.get("cwd") ?? process.cwd()),
					defaultRuntimeId: values.get("runtime"),
					defaultAgentId: values.get("agent"),
					safetyMode: values.get("safety-mode") === "review" ? "review" : "workspace",
				}),
				null,
				2,
			),
		);
		return;
	}

	throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
