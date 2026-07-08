import {
	type SpecialistAgentId,
} from "../packages/agent-kernel/src/index";
import { resolve } from "node:path";
import { createKernel, readLocalProfile } from "./christina-cli";

interface CliOptions {
	command: string;
	prompt?: string;
	provider?: string;
	model?: string;
	cwd: string;
	agents?: SpecialistAgentId[];
	minimumScore: number;
}

function parseArgs(argv: string[]): CliOptions {
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
	const agents = values
		.get("agents")
		?.split(",")
		.map((value) => value.trim().toUpperCase())
		.filter(Boolean) as SpecialistAgentId[] | undefined;
	return {
		command,
		prompt: values.get("prompt"),
		provider: values.get("provider"),
		model: values.get("model"),
		cwd: resolve(values.get("cwd") ?? process.cwd()),
		agents,
		minimumScore: Number(values.get("minimum-score") ?? 60),
	};
}

function printHelp(): void {
	console.log(`CHRISTINA local-model CLI

Commands:
  models
    Discover Ollama, LM Studio, and configured OpenAI-compatible models.

  ask --prompt "..." [--provider ollama|lmstudio|local-openai] [--model MODEL]
    Run one prompt through a local model. If provider/model are omitted,
    CHRISTINA selects the best available model.

  orchestrate --prompt "..." [--agents CODER,CRITIC] [--minimum-score 60]
    Run the CHRISTINA specialist swarm using local models only.

  doctor
    Inspect runtime and provider health. See \`pnpm doctor:runtime\`.

  recommend
    Rank local model candidates. See \`pnpm profile:recommend\`.

Options:
  --cwd PATH
  --provider ID
  --model MODEL
  --agents CSV
  --minimum-score 0-100

Environment:
  CHRISTINA_OLLAMA_BASE_URL          default http://127.0.0.1:11434
  CHRISTINA_LMSTUDIO_BASE_URL        default http://127.0.0.1:1234/v1
  CHRISTINA_LMSTUDIO_API_KEY         optional
  CHRISTINA_LOCAL_OPENAI_BASE_URL    optional generic /v1 endpoint
  CHRISTINA_LOCAL_OPENAI_API_KEY     optional
  CHRISTINA_LOCAL_MODEL_TIMEOUT_MS   default 120000
`);
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options.command === "help" || options.command === "--help" || options.command === "-h") {
		printHelp();
		return;
	}
	if (options.command === "doctor" || options.command === "recommend" || options.command === "profile:init") {
		throw new Error(`Use the pnpm christina-runtime equivalent scripts for ${options.command}.`);
	}
	const kernel = await createKernel();
	if (options.command === "models") {
		const providers = await kernel.localModels.inspectProviders();
		const models = await kernel.localModels.discover({ refresh: true });
		console.log(JSON.stringify({ systemMemory: kernel.localModels.systemMemory(), providers, models }, null, 2));
		return;
	}
	if (options.command === "ask") {
		if (!options.prompt) throw new Error("ask requires --prompt");
		const savedProfile = readLocalProfile();
		let runtimeId = options.provider ?? savedProfile?.provider;
		let model = options.model ?? savedProfile?.model;
		let selection;
		if (!runtimeId || !model) {
			selection = await kernel.localModels.select({
				agentId: "ORCHESTRATOR",
				request: options.prompt,
				providerIds: runtimeId ? [runtimeId] : undefined,
				preferredModel: model,
				minimumScore: options.minimumScore,
			});
			if (!selection) throw new Error("No suitable local model is available.");
			runtimeId = selection.runtimeId;
			model = model ?? selection.model;
		}
		const run = await kernel.start({
			agentId: "LOCAL_ASSISTANT",
			runtimeId,
			workspaceId: "local-cli",
			cwd: options.cwd,
			prompt: options.prompt,
			safetyMode: "review",
			model,
			metadata: {
				localModelScore: selection?.score,
				localModelReasons: selection?.reasons,
			},
		});
		const finished = await kernel.waitForRun(run.id, 30 * 60_000);
		if (finished.status !== "completed") {
			throw new Error(finished.error?.message ?? `Run ended with status ${finished.status}`);
		}
		console.log(finished.outputText ?? "");
		return;
	}
	if (options.command === "orchestrate") {
		if (!options.prompt) throw new Error("orchestrate requires --prompt");
		const savedProfile = readLocalProfile();
		const started = await kernel.orchestrator.start({
			request: options.prompt,
			workspaceId: "local-cli",
			cwd: options.cwd,
			safetyMode: "review",
			explicitAgents: options.agents,
			localModelPolicy: "local-only",
			minimumLocalModelScore: options.minimumScore,
			localProviderIds: savedProfile ? [savedProfile.provider] : undefined,
		});
		const completed = await kernel.orchestrator.wait(started.id, 60 * 60_000);
		console.log(completed.finalResponse ?? completed.error ?? "No response was produced.");
		if (completed.status === "failed") process.exitCode = 1;
		return;
	}
	throw new Error(`Unknown command: ${options.command}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
