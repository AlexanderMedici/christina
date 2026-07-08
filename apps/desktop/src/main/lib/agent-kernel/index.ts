import { join } from "node:path";
import {
	AgentKernel,
	CliRuntimeAdapter,
	type ContextBlock,
	FileAgentKernelStore,
	OpenClaudeRuntimeAdapter,
	OllamaRuntimeAdapter,
	OpenAICompatibleRuntimeAdapter,
	type AgentRuntimeAdapter,
} from "@superset/agent-kernel";
import {
	AGENT_TYPES,
	type AgentType,
	getAgentLaunchConfig,
} from "@superset/shared/agent-command";
import { getSupersetHomeDir } from "../app-environment";

let kernelPromise: Promise<AgentKernel> | undefined;

function createRuntime(agent: AgentType): AgentRuntimeAdapter {
	if (agent === "openclaude") return new OpenClaudeRuntimeAdapter();
	const health = getAgentLaunchConfig({ agent });
	return new CliRuntimeAdapter({
		id: agent,
		binary: health.binary,
		versionArgs: ["--version"],
		buildLaunch(run, prompt) {
			const config = getAgentLaunchConfig({
				agent,
				safetyMode: run.safetyMode,
				prompt,
			});
			return {
				binary: config.binary,
				args: config.args,
				env: config.env,
			};
		},
	});
}

export async function getAgentKernel(): Promise<AgentKernel> {
	kernelPromise ??= (async () => {
		const store = new FileAgentKernelStore(
			join(getSupersetHomeDir(), "agent-kernel"),
		);
		const kernel = new AgentKernel(store);
		for (const agent of AGENT_TYPES)
			kernel.registerRuntime(createRuntime(agent));

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
		await kernel.initialize();
		return kernel;
	})();
	return kernelPromise;
}

export function defaultContextBlocks(input: {
	agentId: string;
	workspaceId: string;
	cwd: string;
	safetyMode: "review" | "workspace" | "unrestricted";
}): ContextBlock[] {
	return [
		{
			id: "christina-host",
			kind: "system",
			priority: 100,
			content:
				"You are running inside CHRISTINA, the Composable Harness Reactive Intelligent Systems Tool Integration Neural Agents. CHRISTINA owns orchestration, session state, run history, workspace boundaries, approvals, and the audit trail. Treat runtime-specific state as secondary.",
		},
		{
			id: "operating-policy",
			kind: "policy",
			priority: 95,
			content:
				input.safetyMode === "review"
					? "Read-only review mode. Inspect and propose changes; do not modify files."
					: input.safetyMode === "workspace"
						? "Workspace mode. Work inside the active repository. Ask before destructive, credential, publishing, messaging, or outside-workspace operations."
						: "Unrestricted runtime mode was explicitly selected, but CHRISTINA still audits actions and protects credentials.",
		},
		{
			id: "workspace",
			kind: "workspace",
			priority: 80,
			content: `Agent: ${input.agentId}\nWorkspace: ${input.workspaceId}\nRoot: ${input.cwd}`,
		},
	];
}
