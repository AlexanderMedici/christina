import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	AgentKernel,
	FileAgentKernelStore,
	OllamaRuntimeAdapter,
	OpenAICompatibleRuntimeAdapter,
} from "../packages/agent-kernel/src/index";

export interface ChristinaLocalProfile {
	provider: "ollama" | "lmstudio" | "local-openai";
	model: string;
	createdAt: string;
}

export function christinaHome(): string {
	return process.env.CHRISTINA_HOME ?? join(homedir(), ".christina");
}

export function localProfilePath(): string {
	return join(christinaHome(), "local-profile.json");
}

export function registerLocalProviders(kernel: AgentKernel): void {
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

export async function createKernel(): Promise<AgentKernel> {
	const kernel = new AgentKernel(
		new FileAgentKernelStore(join(christinaHome(), "agent-kernel")),
	);
	registerLocalProviders(kernel);
	await kernel.initialize();
	return kernel;
}

export function readLocalProfile(): ChristinaLocalProfile | undefined {
	const path = localProfilePath();
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ChristinaLocalProfile>;
		if (
			(parsed.provider === "ollama" ||
				parsed.provider === "lmstudio" ||
				parsed.provider === "local-openai") &&
			typeof parsed.model === "string" &&
			parsed.model.length > 0
		) {
			return {
				provider: parsed.provider,
				model: parsed.model,
				createdAt:
					typeof parsed.createdAt === "string"
						? parsed.createdAt
						: new Date().toISOString(),
			};
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function saveLocalProfile(profile: ChristinaLocalProfile): string {
	const path = localProfilePath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
	return path;
}
