import { freemem, totalmem } from "node:os";
import { EventFactory } from "./events";
import type { AgentRuntimeAdapter } from "./runtime";
import type {
	AgentEvent,
	JsonSchema,
	PreparedRun,
	RuntimeCapabilities,
	RuntimeHealth,
	SpecialistAgentId,
} from "./types";

export type LocalModelProviderKind = "ollama" | "openai-compatible";
export type LocalModelPolicy = "local-only" | "prefer-local" | "balanced" | "cloud-first";

export interface LocalModelProviderConfig {
	id: string;
	label: string;
	kind: LocalModelProviderKind;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	enabled?: boolean;
	trustedLocalhostOnly?: boolean;
}

export interface LocalModelCapabilities {
	streaming: boolean;
	structuredOutput: boolean;
	toolCalling: boolean;
	reasoning: boolean;
	vision: boolean;
}

export interface LocalModelDescriptor {
	id: string;
	providerId: string;
	providerLabel: string;
	model: string;
	displayName: string;
	family?: string;
	parameterSize?: string;
	quantization?: string;
	sizeBytes?: number;
	contextWindow?: number;
	loaded?: boolean;
	modifiedAt?: string;
	capabilities: LocalModelCapabilities;
	metadata?: Record<string, unknown>;
}

export interface LocalModelProviderStatus {
	id: string;
	label: string;
	kind: LocalModelProviderKind;
	baseUrl: string;
	enabled: boolean;
	health: RuntimeHealth;
	modelCount: number;
}

export interface LocalModelSelectionRequest {
	agentId: SpecialistAgentId | "ORCHESTRATOR";
	request: string;
	providerIds?: string[];
	requiredContextTokens?: number;
	requiresStructuredOutput?: boolean;
	requiresTools?: boolean;
	minimumScore?: number;
	preferredModel?: string;
}

export interface LocalModelScoreBreakdown {
	taskFit: number;
	hardwareFit: number;
	contextFit: number;
	capabilityFit: number;
	efficiency: number;
	availability: number;
}

export interface LocalModelSelection {
	providerId: string;
	runtimeId: string;
	model: string;
	displayName: string;
	score: number;
	breakdown: LocalModelScoreBreakdown;
	reasons: string[];
	descriptor: LocalModelDescriptor;
}

export interface LocalModelProvider extends AgentRuntimeAdapter {
	readonly config: LocalModelProviderConfig;
	listModels(): Promise<LocalModelDescriptor[]>;
}

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, "");
}

function safeUrl(baseUrl: string, path: string): string {
	return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(config: LocalModelProviderConfig): Record<string, string> {
	return {
		"Content-Type": "application/json",
		...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
		...(config.headers ?? {}),
	};
}

function verifyEndpoint(config: LocalModelProviderConfig): void {
	if (config.trustedLocalhostOnly === false) return;
	const parsed = new URL(config.baseUrl);
	if (!LOCALHOST_NAMES.has(parsed.hostname)) {
		throw new Error(
			`Local model provider ${config.id} must use localhost unless trustedLocalhostOnly is disabled explicitly.`,
		);
	}
}

function linkedAbortController(
	runId: string,
	controllers: Map<string, AbortController>,
	timeoutMs: number,
): { controller: AbortController; cleanup: () => void } {
	const controller = new AbortController();
	controllers.set(runId, controller);
	const timer = setTimeout(() => controller.abort(new Error("Local model request timed out.")), timeoutMs);
	return {
		controller,
		cleanup: () => {
			clearTimeout(timer);
			controllers.delete(runId);
		},
	};
}

async function* decodeLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const line of lines) yield line;
		}
		buffer += decoder.decode();
		if (buffer) yield buffer;
	} finally {
		reader.releaseLock();
	}
}

function renderedPrompt(run: PreparedRun): string {
	return run.context.rendered
		? `${run.context.rendered}\n\n## USER REQUEST\n\n${run.prompt}`
		: run.prompt;
}

function modelNameCapabilities(name: string): LocalModelCapabilities {
	const value = name.toLowerCase();
	const embedding = /embed|embedding|rerank/.test(value);
	return {
		streaming: !embedding,
		structuredOutput: !embedding,
		toolCalling: !embedding && !/(tiny|0\.5b|1b|1\.5b)/.test(value),
		reasoning: /reason|r1|qwq|qwen3|gpt-oss|deepseek/.test(value),
		vision: /vision|vl|llava|moondream|gemma3/.test(value),
	};
}

function schemaForProvider(schema?: JsonSchema): Record<string, unknown> | undefined {
	if (!schema) return undefined;
	return schema as Record<string, unknown>;
}

export class OllamaRuntimeAdapter implements LocalModelProvider {
	readonly id: string;
	readonly capabilities: RuntimeCapabilities = {
		resume: false,
		cancellation: true,
		structuredToolEvents: true,
		nativeApprovals: false,
		streaming: true,
		structuredOutput: true,
	};
	readonly config: LocalModelProviderConfig;
	private readonly controllers = new Map<string, AbortController>();

	constructor(config: Partial<LocalModelProviderConfig> = {}) {
		this.config = {
			id: config.id ?? "ollama",
			label: config.label ?? "Ollama",
			kind: "ollama",
			baseUrl: config.baseUrl ?? "http://127.0.0.1:11434",
			apiKey: config.apiKey,
			headers: config.headers,
			timeoutMs: config.timeoutMs ?? 120_000,
			enabled: config.enabled ?? true,
			trustedLocalhostOnly: config.trustedLocalhostOnly ?? true,
		};
		verifyEndpoint(this.config);
		this.id = this.config.id;
	}

	supports(run: PreparedRun): boolean {
		return run.runtimeId === this.id && Boolean(run.model);
	}

	async listModels(): Promise<LocalModelDescriptor[]> {
		if (this.config.enabled === false) return [];
		const response = await fetch(safeUrl(this.config.baseUrl, "/api/tags"), {
			headers: authHeaders(this.config),
			signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
		});
		if (!response.ok) throw new Error(`Ollama model discovery failed: HTTP ${response.status}`);
		const payload = (await response.json()) as {
			models?: Array<{
				name?: string;
				model?: string;
				modified_at?: string;
				size?: number;
				digest?: string;
				details?: {
					family?: string;
					parameter_size?: string;
					quantization_level?: string;
					families?: string[];
				};
			}>;
		};
		let loadedNames = new Set<string>();
		try {
			const running = await fetch(safeUrl(this.config.baseUrl, "/api/ps"), {
				headers: authHeaders(this.config),
				signal: AbortSignal.timeout(3_000),
			});
			if (running.ok) {
				const runningPayload = (await running.json()) as { models?: Array<{ name?: string; model?: string }> };
				loadedNames = new Set(
					(runningPayload.models ?? []).flatMap((item) => [item.name, item.model]).filter(Boolean) as string[],
				);
			}
		} catch {
			// Running-model discovery is optional.
		}
		return (payload.models ?? []).reduce<LocalModelDescriptor[]>((models, item) => {
			const model = item.model ?? item.name;
			if (!model) return models;
			models.push({
				id: `${this.id}:${model}`,
				providerId: this.id,
				providerLabel: this.config.label,
				model,
				displayName: model,
				family: item.details?.family,
				parameterSize: item.details?.parameter_size,
				quantization: item.details?.quantization_level,
				sizeBytes: item.size,
				loaded: loadedNames.has(model) || Boolean(item.name && loadedNames.has(item.name)),
				modifiedAt: item.modified_at,
				capabilities: modelNameCapabilities(model),
				metadata: { digest: item.digest, families: item.details?.families },
			});
			return models;
		}, []);
	}

	async *start(run: PreparedRun): AsyncIterable<AgentEvent> {
		const events = new EventFactory(run.id);
		const model = run.model;
		if (!model) {
			yield events.create({
				type: "run.failed",
				error: { code: "local_model_missing", message: "Ollama requires a model name.", retryable: false },
			});
			return;
		}
		const started = Date.now();
		const { controller, cleanup } = linkedAbortController(
			run.id,
			this.controllers,
			this.config.timeoutMs ?? 120_000,
		);
		yield events.create({ type: "run.started", runtimeId: this.id });
		try {
			const response = await fetch(safeUrl(this.config.baseUrl, "/api/chat"), {
				method: "POST",
				headers: authHeaders(this.config),
				signal: controller.signal,
				body: JSON.stringify({
					model,
					messages: [{ role: "user", content: renderedPrompt(run) }],
					stream: true,
					keep_alive: run.metadata?.keepAlive ?? "5m",
					...(run.outputContract?.format === "json"
						? { format: schemaForProvider(run.outputContract.schema) ?? "json" }
						: {}),
				}),
			});
			if (!response.ok || !response.body) {
				throw new Error(`Ollama request failed: HTTP ${response.status} ${await response.text()}`);
			}
			let toolIndex = 0;
			for await (const line of decodeLines(response.body)) {
				if (!line.trim()) continue;
				const item = JSON.parse(line) as {
					message?: {
						content?: string;
						tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
					};
					done?: boolean;
					prompt_eval_count?: number;
					eval_count?: number;
					total_duration?: number;
				};
				if (item.message?.content) {
					yield events.create({ type: "assistant.delta", text: item.message.content });
				}
				for (const call of item.message?.tool_calls ?? []) {
					toolIndex += 1;
					yield events.create({
						type: "tool.requested",
						call: {
							id: `${run.id}-ollama-tool-${toolIndex}`,
							toolId: call.function?.name ?? "unknown",
							input: call.function?.arguments ?? {},
						},
					});
				}
				if (item.done) {
					yield events.create({
						type: "usage.updated",
						usage: {
							inputTokens: item.prompt_eval_count,
							outputTokens: item.eval_count,
							durationMs: item.total_duration
								? Math.round(item.total_duration / 1_000_000)
								: Date.now() - started,
						},
					});
				}
			}
			yield events.create({ type: "run.completed", outcome: "success", exitCode: 0 });
		} catch (error) {
			if (controller.signal.aborted) {
				yield events.create({ type: "run.cancelled", reason: "Local model run was cancelled or timed out." });
			} else {
				yield events.create({
					type: "run.failed",
					error: {
						code: "ollama_request_failed",
						message: error instanceof Error ? error.message : String(error),
						retryable: true,
					},
				});
			}
		} finally {
			cleanup();
		}
	}

	async cancel(runId: string): Promise<void> {
		this.controllers.get(runId)?.abort();
	}

	async healthCheck(): Promise<RuntimeHealth> {
		if (this.config.enabled === false) return { available: false, detail: "Provider is disabled." };
		const started = Date.now();
		try {
			const models = await this.listModels();
			return {
				available: true,
				detail: `${models.length} local model${models.length === 1 ? "" : "s"} discovered.`,
				latencyMs: Date.now() - started,
			};
		} catch (error) {
			return {
				available: false,
				detail: error instanceof Error ? error.message : String(error),
				latencyMs: Date.now() - started,
			};
		}
	}
}

export class OpenAICompatibleRuntimeAdapter implements LocalModelProvider {
	readonly id: string;
	readonly capabilities: RuntimeCapabilities = {
		resume: false,
		cancellation: true,
		structuredToolEvents: true,
		nativeApprovals: false,
		streaming: true,
		structuredOutput: true,
	};
	readonly config: LocalModelProviderConfig;
	private readonly controllers = new Map<string, AbortController>();

	constructor(config: LocalModelProviderConfig) {
		this.config = {
			...config,
			kind: "openai-compatible",
			timeoutMs: config.timeoutMs ?? 120_000,
			enabled: config.enabled ?? true,
			trustedLocalhostOnly: config.trustedLocalhostOnly ?? true,
		};
		verifyEndpoint(this.config);
		this.id = this.config.id;
	}

	supports(run: PreparedRun): boolean {
		return run.runtimeId === this.id && Boolean(run.model);
	}

	async listModels(): Promise<LocalModelDescriptor[]> {
		if (this.config.enabled === false) return [];
		const response = await fetch(safeUrl(this.config.baseUrl, "/models"), {
			headers: authHeaders(this.config),
			signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
		});
		if (!response.ok) throw new Error(`${this.config.label} model discovery failed: HTTP ${response.status}`);
		const payload = (await response.json()) as {
			data?: Array<{ id?: string; object?: string; owned_by?: string; context_length?: number }>;
			models?: Array<{ id?: string; key?: string; display_name?: string; max_context_length?: number; loaded?: boolean }>;
		};
		const rows: Array<{
			id?: string;
			key?: string;
			display_name?: string;
			owned_by?: string;
			context_length?: number;
			max_context_length?: number;
			loaded?: boolean;
		}> = [...(payload.data ?? []), ...(payload.models ?? [])];
		return rows.reduce<LocalModelDescriptor[]>((models, item) => {
			const model = item.id ?? item.key;
			if (!model) return models;
			models.push({
				id: `${this.id}:${model}`,
				providerId: this.id,
				providerLabel: this.config.label,
				model,
				displayName: item.display_name ?? model,
				contextWindow: item.context_length ?? item.max_context_length,
				loaded: item.loaded,
				capabilities: modelNameCapabilities(model),
				metadata: { ownedBy: item.owned_by },
			});
			return models;
		}, []);
	}

	async *start(run: PreparedRun): AsyncIterable<AgentEvent> {
		const events = new EventFactory(run.id);
		const model = run.model;
		if (!model) {
			yield events.create({
				type: "run.failed",
				error: { code: "local_model_missing", message: `${this.config.label} requires a model name.`, retryable: false },
			});
			return;
		}
		const started = Date.now();
		const { controller, cleanup } = linkedAbortController(
			run.id,
			this.controllers,
			this.config.timeoutMs ?? 120_000,
		);
		yield events.create({ type: "run.started", runtimeId: this.id });
		try {
			const response = await fetch(safeUrl(this.config.baseUrl, "/chat/completions"), {
				method: "POST",
				headers: authHeaders(this.config),
				signal: controller.signal,
				body: JSON.stringify({
					model,
					messages: [{ role: "user", content: renderedPrompt(run) }],
					stream: true,
					stream_options: { include_usage: true },
					...(run.outputContract?.format === "json"
						? {
							response_format: run.outputContract.schema
								? {
									type: "json_schema",
									json_schema: {
										name: "christina_output",
										strict: run.outputContract.strict ?? true,
										schema: run.outputContract.schema,
									},
								}
								: { type: "json_object" },
						}
						: {}),
				}),
			});
			if (!response.ok || !response.body) {
				throw new Error(`${this.config.label} request failed: HTTP ${response.status} ${await response.text()}`);
			}
			const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
			for await (const rawLine of decodeLines(response.body)) {
				const line = rawLine.trim();
				if (!line || line.startsWith(":")) continue;
				if (!line.startsWith("data:")) continue;
				const data = line.slice(5).trim();
				if (data === "[DONE]") break;
				const item = JSON.parse(data) as {
					choices?: Array<{
						delta?: {
							content?: string;
							tool_calls?: Array<{
								index?: number;
								id?: string;
								function?: { name?: string; arguments?: string };
							}>;
						};
						finish_reason?: string | null;
					}>;
					usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
				};
				for (const choice of item.choices ?? []) {
					if (choice.delta?.content) {
						yield events.create({ type: "assistant.delta", text: choice.delta.content });
					}
					for (const part of choice.delta?.tool_calls ?? []) {
						const index = part.index ?? 0;
						const existing = toolCalls.get(index) ?? {
							id: part.id ?? `${run.id}-local-tool-${index}`,
							name: part.function?.name ?? "",
							arguments: "",
						};
						if (part.id) existing.id = part.id;
						if (part.function?.name) existing.name += part.function.name;
						if (part.function?.arguments) existing.arguments += part.function.arguments;
						toolCalls.set(index, existing);
					}
					if (choice.finish_reason === "tool_calls") {
						for (const call of toolCalls.values()) {
							let input: unknown = call.arguments;
							try {
								input = JSON.parse(call.arguments || "{}");
							} catch {
								// Keep malformed arguments visible to the tool gateway.
							}
							yield events.create({
								type: "tool.requested",
								call: { id: call.id, toolId: call.name || "unknown", input },
							});
						}
					}
				}
				if (item.usage) {
					yield events.create({
						type: "usage.updated",
						usage: {
							inputTokens: item.usage.prompt_tokens,
							outputTokens: item.usage.completion_tokens,
							durationMs: Date.now() - started,
						},
					});
				}
			}
			yield events.create({ type: "run.completed", outcome: "success", exitCode: 0 });
		} catch (error) {
			if (controller.signal.aborted) {
				yield events.create({ type: "run.cancelled", reason: "Local model run was cancelled or timed out." });
			} else {
				yield events.create({
					type: "run.failed",
					error: {
						code: "local_openai_request_failed",
						message: error instanceof Error ? error.message : String(error),
						retryable: true,
					},
				});
			}
		} finally {
			cleanup();
		}
	}

	async cancel(runId: string): Promise<void> {
		this.controllers.get(runId)?.abort();
	}

	async healthCheck(): Promise<RuntimeHealth> {
		if (this.config.enabled === false) return { available: false, detail: "Provider is disabled." };
		const started = Date.now();
		try {
			const models = await this.listModels();
			return {
				available: true,
				detail: `${models.length} local model${models.length === 1 ? "" : "s"} discovered.`,
				latencyMs: Date.now() - started,
			};
		} catch (error) {
			return {
				available: false,
				detail: error instanceof Error ? error.message : String(error),
				latencyMs: Date.now() - started,
			};
		}
	}
}

const ROLE_KEYWORDS: Record<SpecialistAgentId | "ORCHESTRATOR", string[]> = {
	RESEARCHER: ["reason", "r1", "qwen3", "llama", "mistral", "gemma", "deepseek"],
	CODER: ["coder", "code", "deepseek", "qwen", "codestral", "starcoder", "granite"],
	FACT_CHECKER: ["reason", "r1", "qwen3", "deepseek", "llama", "gemma"],
	SUMMARIZER: ["llama", "qwen", "mistral", "gemma", "phi", "small", "mini"],
	TOOL_EXECUTOR: ["tool", "function", "qwen", "llama", "mistral", "granite", "gpt-oss"],
	CRITIC: ["reason", "r1", "qwen3", "deepseek", "llama", "mistral"],
	ORCHESTRATOR: ["reason", "qwen3", "llama", "mistral", "deepseek", "gpt-oss"],
};

function parameterBillions(value?: string): number | undefined {
	if (!value) return undefined;
	const match = value.match(/([\d.]+)\s*[bB]/);
	return match ? Number(match[1]) : undefined;
}

function inferBillions(name: string): number | undefined {
	const match = name.match(/(?:^|[-_:])([\d.]+)b(?:$|[-_:])/i);
	return match ? Number(match[1]) : undefined;
}

function taskFit(agentId: SpecialistAgentId | "ORCHESTRATOR", model: LocalModelDescriptor): number {
	const haystack = `${model.model} ${model.family ?? ""}`.toLowerCase();
	const matches = ROLE_KEYWORDS[agentId].filter((keyword) => haystack.includes(keyword)).length;
	let score = Math.min(100, 45 + matches * 13);
	if (/embed|embedding|rerank/.test(haystack)) score = 0;
	if (agentId === "CODER" && /coder|codestral|starcoder|code/.test(haystack)) score += 18;
	if (agentId === "SUMMARIZER" && /(1b|1\.5b|3b|4b|7b|8b|mini|small)/.test(haystack)) score += 8;
	return Math.min(100, score);
}

function hardwareFit(model: LocalModelDescriptor): number {
	const free = freemem();
	if (model.loaded) return 100;
	if (model.sizeBytes) {
		const ratio = model.sizeBytes / Math.max(1, free);
		if (ratio <= 0.45) return 100;
		if (ratio <= 0.7) return 88;
		if (ratio <= 0.9) return 65;
		if (ratio <= 1.1) return 35;
		return 5;
	}
	const billions = parameterBillions(model.parameterSize) ?? inferBillions(model.model);
	if (!billions) return 70;
	const estimatedBytes = billions * 0.75 * 1024 ** 3;
	const ratio = estimatedBytes / Math.max(1, free);
	if (ratio <= 0.45) return 95;
	if (ratio <= 0.75) return 80;
	if (ratio <= 1) return 55;
	return 20;
}

function efficiencyScore(model: LocalModelDescriptor): number {
	if (model.loaded) return 100;
	const billions = parameterBillions(model.parameterSize) ?? inferBillions(model.model);
	if (!billions) return 65;
	if (billions <= 4) return 95;
	if (billions <= 9) return 88;
	if (billions <= 15) return 76;
	if (billions <= 35) return 62;
	if (billions <= 75) return 42;
	return 25;
}

function contextFit(model: LocalModelDescriptor, required = 8_192): number {
	if (!model.contextWindow) return required <= 8_192 ? 75 : 55;
	if (model.contextWindow >= required * 2) return 100;
	if (model.contextWindow >= required) return 85;
	if (model.contextWindow >= required * 0.75) return 50;
	return 10;
}

function capabilityFit(
	model: LocalModelDescriptor,
	input: Pick<LocalModelSelectionRequest, "requiresStructuredOutput" | "requiresTools">,
): number {
	let score = 100;
	if (input.requiresStructuredOutput && !model.capabilities.structuredOutput) score -= 55;
	if (input.requiresTools && !model.capabilities.toolCalling) score -= 65;
	return Math.max(0, score);
}

export class LocalModelService {
	private readonly providers = new Map<string, LocalModelProvider>();
	private cache?: { at: number; models: LocalModelDescriptor[] };

	register(provider: LocalModelProvider): void {
		if (this.providers.has(provider.id)) throw new Error(`Local model provider already registered: ${provider.id}`);
		this.providers.set(provider.id, provider);
		this.cache = undefined;
	}

	get(id: string): LocalModelProvider {
		const provider = this.providers.get(id);
		if (!provider) throw new Error(`Unknown local model provider: ${id}`);
		return provider;
	}

	listProviders(): LocalModelProvider[] {
		return [...this.providers.values()];
	}

	async inspectProviders(): Promise<LocalModelProviderStatus[]> {
		return Promise.all(
			this.listProviders().map(async (provider) => {
				const health = await provider.healthCheck();
				let modelCount = 0;
				if (health.available) {
					try {
						modelCount = (await provider.listModels()).length;
					} catch {
						modelCount = 0;
					}
				}
				return {
					id: provider.id,
					label: provider.config.label,
					kind: provider.config.kind,
					baseUrl: provider.config.baseUrl,
					enabled: provider.config.enabled !== false,
					health,
					modelCount,
				};
			}),
		);
	}

	async discover(options: { providerIds?: string[]; refresh?: boolean } = {}): Promise<LocalModelDescriptor[]> {
		if (!options.refresh && !options.providerIds && this.cache && Date.now() - this.cache.at < 15_000) {
			return this.cache.models;
		}
		const selected = this.listProviders().filter(
			(provider) => !options.providerIds || options.providerIds.includes(provider.id),
		);
		const settled = await Promise.allSettled(selected.map((provider) => provider.listModels()));
		const models = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
		if (!options.providerIds) this.cache = { at: Date.now(), models };
		return models;
	}

	async select(input: LocalModelSelectionRequest): Promise<LocalModelSelection | undefined> {
		const models = await this.discover({ providerIds: input.providerIds });
		const minimumScore = input.minimumScore ?? 60;
		const selections = models.map((model): LocalModelSelection => {
			const breakdown: LocalModelScoreBreakdown = {
				taskFit: taskFit(input.agentId, model),
				hardwareFit: hardwareFit(model),
				contextFit: contextFit(model, input.requiredContextTokens),
				capabilityFit: capabilityFit(model, input),
				efficiency: efficiencyScore(model),
				availability: model.loaded ? 100 : 75,
			};
			let score =
				breakdown.taskFit * 0.34 +
				breakdown.hardwareFit * 0.2 +
				breakdown.contextFit * 0.14 +
				breakdown.capabilityFit * 0.14 +
				breakdown.efficiency * 0.12 +
				breakdown.availability * 0.06;
			if (input.preferredModel && model.model === input.preferredModel) score += 12;
			const reasons = [
				`Task fit ${Math.round(breakdown.taskFit)}%`,
				`Hardware fit ${Math.round(breakdown.hardwareFit)}%`,
				`Context fit ${Math.round(breakdown.contextFit)}%`,
				`Capability fit ${Math.round(breakdown.capabilityFit)}%`,
				model.loaded ? "Already loaded" : "Available but not confirmed loaded",
			];
			return {
				providerId: model.providerId,
				runtimeId: model.providerId,
				model: model.model,
				displayName: model.displayName,
				score: Math.max(0, Math.min(100, Math.round(score))),
				breakdown,
				reasons,
				descriptor: model,
			};
		});
		selections.sort(
			(a, b) =>
				b.score - a.score ||
				Number(Boolean(b.descriptor.loaded)) - Number(Boolean(a.descriptor.loaded)) ||
				a.model.localeCompare(b.model),
		);
		return selections.find((item) => item.score >= minimumScore);
	}

	systemMemory(): { totalBytes: number; freeBytes: number } {
		return { totalBytes: totalmem(), freeBytes: freemem() };
	}
}
