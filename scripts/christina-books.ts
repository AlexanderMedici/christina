import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	AgentKernel,
	FileAgentKernelStore,
	OllamaRuntimeAdapter,
	OpenAICompatibleRuntimeAdapter,
	type KnowledgeAgentProfile,
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
		} else values.set(item.slice(2), "true");
	}
	return { command, values };
}

function required(values: Map<string, string>, key: string): string {
	const value = values.get(key)?.trim();
	if (!value) throw new Error(`Missing required option --${key}`);
	return value;
}

function csv(value: string | undefined): string[] {
	return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
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
	console.log(`CHRISTINA private book-library CLI

Commands:
  add --name "My Books" --path "PATH" [--extensions pdf,epub,txt,md]
      Register a file or folder and immediately scan it.

  list
      List libraries, assigned agents, and local book tutors.

  scan --library LIBRARY_ID
      Refresh a library after files are added, changed, or removed.

  remove --library LIBRARY_ID
      Delete CHRISTINA's extracted index and all assignments. Original book files are untouched.

  assign --library LIBRARY_ID --agent AGENT_ID [--access read|teach]
      Grant one existing agent access. Other agents remain denied.

  revoke --library LIBRARY_ID --agent AGENT_ID
      Remove access immediately.

  agent --name "Book Tutor" --library ID[,ID] [--provider ollama] [--model MODEL]
      Create a private local tutor. If provider/model are omitted, CHRISTINA selects one.

  ask --agent PROFILE_ID --question "..." [--mode answer|teach|quiz|study-guide]
      Ask or learn from the assigned books.

  search --agent AGENT_ID --query "..." [--library ID[,ID]]
      Test retrieval and citations without calling a model.

Examples:
  Windows:
    bun run books:add -- --name "MERN Books" --path "E:\\Books\\MERN"

  macOS:
    bun run books:add -- --name "MERN Books" --path "/Volumes/Books/MERN"

  Create tutor:
    bun run books:agent -- --name "MERN Tutor" --library LIBRARY_ID --provider ollama --model qwen2.5:7b

  Learn:
    bun run books:ask -- --agent PROFILE_ID --mode teach --question "Teach me closures from these books"
`);
}

async function selectRuntime(kernel: AgentKernel, values: Map<string, string>): Promise<{ runtimeId: string; model: string }> {
	const provider = values.get("provider");
	const requestedModel = values.get("model");
	if (provider && requestedModel) return { runtimeId: provider, model: requestedModel };
	const selection = await kernel.localModels.select({
		agentId: "RESEARCHER",
		request: "Read private books, answer questions, and teach the user accurately.",
		providerIds: provider ? [provider] : undefined,
		preferredModel: requestedModel,
		requiresStructuredOutput: false,
		minimumScore: Number(values.get("minimum-score") ?? 55),
	});
	if (!selection) throw new Error("No suitable local model is available. Start Ollama or LM Studio and load a model.");
	return { runtimeId: selection.runtimeId, model: requestedModel ?? selection.model };
}

function profileView(profile: KnowledgeAgentProfile) {
	return {
		id: profile.id,
		name: profile.name,
		runtimeId: profile.runtimeId,
		model: profile.model,
		localOnly: profile.localOnly,
		libraryIds: profile.libraryIds,
		teachingStyle: profile.teachingStyle,
		status: profile.status,
	};
}

async function main(): Promise<void> {
	const { command, values } = parseArgs(process.argv.slice(2));
	if (["help", "--help", "-h"].includes(command)) {
		printHelp();
		return;
	}
	const kernel = await createKernel();

	if (command === "add") {
		const library = await kernel.books.createLibrary({
			name: required(values, "name"),
			sourcePath: resolve(required(values, "path")),
			includeExtensions: csv(values.get("extensions")),
			recursive: values.get("recursive") !== "false",
			followSymlinks: values.get("follow-symlinks") === "true",
			maxFileSizeBytes: values.get("max-file-mb")
				? Number(values.get("max-file-mb")) * 1024 * 1024
				: undefined,
		});
		const scan = await kernel.books.scanLibrary(library.id);
		console.log(JSON.stringify(scan, null, 2));
		return;
	}

	if (command === "list") {
		const [libraries, assignments, agents] = await Promise.all([
			kernel.books.listLibraries(),
			kernel.books.listAssignments(),
			kernel.books.listKnowledgeAgents(),
		]);
		console.log(JSON.stringify({ libraries, assignments, agents: agents.map(profileView) }, null, 2));
		return;
	}

	if (command === "remove") {
		await kernel.books.deleteLibrary(required(values, "library"));
		console.log("Library index and assignments removed. Original files were not changed.");
		return;
	}

	if (command === "scan") {
		console.log(JSON.stringify(await kernel.books.scanLibrary(required(values, "library")), null, 2));
		return;
	}

	if (command === "assign") {
		console.log(JSON.stringify(await kernel.books.assignLibrary({
			libraryId: required(values, "library"),
			agentId: required(values, "agent"),
			access: values.get("access") === "teach" ? "teach" : "read",
			createdBy: "cli-user",
		}), null, 2));
		return;
	}

	if (command === "revoke") {
		await kernel.books.revokeLibrary(required(values, "library"), required(values, "agent"));
		console.log("Access revoked.");
		return;
	}

	if (command === "agent") {
		const libraries = csv(required(values, "library"));
		if (libraries.length === 0) throw new Error("At least one library ID is required.");
		const runtime = await selectRuntime(kernel, values);
		const styleValue = values.get("style");
		const teachingStyle =
			styleValue === "socratic" || styleValue === "direct" || styleValue === "exam-prep"
				? styleValue
				: "step-by-step";
		const profile = await kernel.createKnowledgeAgent({
			name: required(values, "name"),
			...runtime,
			libraryIds: libraries,
			teachingStyle,
		});
		console.log(JSON.stringify(profileView(profile), null, 2));
		return;
	}

	if (command === "ask") {
		const modeValue = values.get("mode");
		const mode =
			modeValue === "teach" || modeValue === "quiz" || modeValue === "study-guide"
				? modeValue
				: "answer";
		const result = await kernel.askKnowledgeAgent({
			agentProfileId: required(values, "agent"),
			question: required(values, "question"),
			mode,
			cwd: resolve(values.get("cwd") ?? process.cwd()),
			maxChunks: Number(values.get("max-chunks") ?? 10),
			maxContextTokens: Number(values.get("max-context-tokens") ?? 10_000),
		});
		if (result.run.status !== "completed") {
			throw new Error(result.run.error?.message ?? `Run ended with status ${result.run.status}`);
		}
		console.log(result.run.outputText ?? "");
		console.log("\nSources used:");
		for (const citation of result.citations) console.log(`- ${citation}`);
		return;
	}

	if (command === "search") {
		const results = await kernel.books.search({
			agentId: required(values, "agent"),
			query: required(values, "query"),
			libraryIds: csv(values.get("library")),
			maxResults: Number(values.get("max-results") ?? 10),
		});
		console.log(JSON.stringify(results.map((result) => ({
			score: result.score,
			citation: result.citation,
			text: result.chunk.text,
		})), null, 2));
		return;
	}

	throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
