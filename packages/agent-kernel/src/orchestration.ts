import { randomUUID } from "node:crypto";
import type { AgentKernel, StartRunRequest } from "./kernel";
import type { LocalModelPolicy, LocalModelSelection } from "./local-models";
import type {
	AgentRun,
	AgentSafetyMode,
	ChristinaConfidence,
	ChristinaOrchestration,
	ChristinaOrchestrationInput,
	ChristinaRoutePlan,
	ChristinaSource,
	ChristinaSpecialistContribution,
	ChristinaSubtask,
	SpecialistAgentId,
	SpecialistAgentProfile,
} from "./types";

export const CHRISTINA_MAX_SPECIALIST_RESPONSES = 6;

export const CHRISTINA_SPECIALISTS: Record<SpecialistAgentId, SpecialistAgentProfile> = {
	RESEARCHER: {
		id: "RESEARCHER",
		specialty: "Deep analysis, long-form reading, and citations",
		bestFor: ["literature reviews", "technical documentation", "history", "research"],
		preferredRuntimeId: "openclaude",
		preferredModel: "claude-3-7-sonnet",
	},
	CODER: {
		id: "CODER",
		specialty: "Code generation, debugging, and refactoring",
		bestFor: ["functions", "bug fixes", "algorithms", "implementation"],
		preferredRuntimeId: "codex",
		preferredModel: "gpt-5.5",
	},
	FACT_CHECKER: {
		id: "FACT_CHECKER",
		specialty: "Verification and hallucination detection",
		bestFor: ["claim validation", "cross-referencing", "source verification"],
		preferredRuntimeId: "gemini",
		preferredModel: "gemini-2.0-pro",
	},
	SUMMARIZER: {
		id: "SUMMARIZER",
		specialty: "Condensation and distillation",
		bestFor: ["executive summaries", "meeting notes", "TL;DRs"],
		preferredRuntimeId: "opencode",
		preferredModel: "meta-llama/llama-3.3-70b-instruct",
	},
	TOOL_EXECUTOR: {
		id: "TOOL_EXECUTOR",
		specialty: "API calls, database queries, calculations, and file operations",
		bestFor: ["data retrieval", "calculation", "automation", "external tools"],
		preferredRuntimeId: "opencode",
		preferredModel: "openai/gpt-4o",
	},
	CRITIC: {
		id: "CRITIC",
		specialty: "Adversarial review and gap analysis",
		bestFor: ["edge cases", "security review", "quality review", "risks"],
		preferredRuntimeId: "claude",
		preferredModel: "claude-3-5-haiku",
	},
};

const ROLE_ORDER: SpecialistAgentId[] = [
	"RESEARCHER",
	"CODER",
	"TOOL_EXECUTOR",
	"FACT_CHECKER",
	"CRITIC",
	"SUMMARIZER",
];

const ROUTING_PATTERNS: Record<SpecialistAgentId, RegExp[]> = {
	RESEARCHER: [
		/\bresearch\b/i,
		/\bcitations?\b/i,
		/\bsources?\b/i,
		/\bliterature\b/i,
		/\bhistory\b/i,
		/\btechnical (?:docs?|documentation)\b/i,
		/\bdeep analysis\b/i,
	],
	CODER: [
		/\bcode\b/i,
		/\bbuild\b/i,
		/\bimplement\b/i,
		/\bdebug\b/i,
		/\brefactor\b/i,
		/\bfunction\b/i,
		/\bscript\b/i,
		/\bapi\b/i,
		/\bbug\b/i,
		/\btypescript\b/i,
		/\bjavascript\b/i,
		/\bpython\b/i,
		/\bscraper\b/i,
	],
	FACT_CHECKER: [
		/\bfact[ -]?check\b/i,
		/\bverify\b/i,
		/\bvalidate (?:the )?(?:claim|claims|facts?|sources?)\b/i,
		/\bcross[ -]?reference\b/i,
		/\bare you sure\b/i,
	],
	SUMMARIZER: [
		/\bsummar(?:y|ize|ise)\b/i,
		/\bshorten\b/i,
		/\bcondense\b/i,
		/\btl;?dr\b/i,
		/\bexecutive summary\b/i,
		/\bmeeting notes\b/i,
	],
	TOOL_EXECUTOR: [
		/\bquer(?:y|ies|ied|ying)\b[^.\n]{0,40}\b(?:database|db|api)\b/i,
		/\bapi call\b/i,
		/\bcalculate\b/i,
		/\bcompute\b/i,
		/\bfile operation\b/i,
		/\bsend (?:an )?email\b/i,
		/\bretrieve (?:live|current|actual|real)\b/i,
		/\bweb search\b/i,
		/\bdatabase\b/i,
	],
	CRITIC: [
		/\breview\b/i,
		/\bcritique\b/i,
		/\baudit\b/i,
		/\bedge cases?\b/i,
		/\bgaps?\b/i,
		/\bsecurity\b/i,
		/\brisks?\b/i,
		/\bimprov(?:e|ement)\b/i,
	],
};

function unique<T>(items: T[]): T[] {
	return [...new Set(items)];
}

function selectedRoles(request: string, explicit?: SpecialistAgentId[]): SpecialistAgentId[] {
	const roles = explicit ? [...explicit] : [];
	for (const role of ROLE_ORDER) {
		if (ROUTING_PATTERNS[role].some((pattern) => pattern.test(request))) roles.push(role);
		if (new RegExp(`\\b${role.replace("_", "[ _-]?")}\\b`, "i").test(request)) {
			roles.push(role);
		}
	}
	const deduplicated = unique(roles);
	if (
		deduplicated.includes("RESEARCHER") &&
		/\b(?:current|latest|recent|facts?|claims?|statistics?|data|sources?|citations?)\b/i.test(request)
	) {
		deduplicated.push("FACT_CHECKER");
	}
	if (deduplicated.length === 0) deduplicated.push("RESEARCHER");
	return ROLE_ORDER.filter((role) => unique(deduplicated).includes(role)).slice(
		0,
		CHRISTINA_MAX_SPECIALIST_RESPONSES,
	);
}

function dependenciesFor(role: SpecialistAgentId, selected: SpecialistAgentId[]): SpecialistAgentId[] {
	const producers = selected.filter((item) =>
		["RESEARCHER", "CODER", "TOOL_EXECUTOR"].includes(item),
	);
	if (role === "FACT_CHECKER") return producers;
	if (role === "CRITIC") return producers;
	if (role === "SUMMARIZER") return selected.filter((item) => item !== "SUMMARIZER");
	return [];
}

function rolePrompt(role: SpecialistAgentId, request: string): string {
	const shared = `You are CHRISTINA's ${role} specialist. Work only on your assigned subtask.\n\nOriginal user request:\n${request}\n\nReturn a JSON object matching the requested schema. Be direct, evidence-aware, and do not claim actions you did not perform.`;
	const instructions: Record<SpecialistAgentId, string> = {
		RESEARCHER:
			"Research the request deeply. Identify authoritative sources, important context, competing interpretations, and evidence gaps. Put source metadata in sources and distinguish verified facts from analysis.",
		CODER:
			"Produce or assess the implementation. Include the usable code or patch in content, explain important design decisions, list validation performed, and disclose anything not tested.",
		FACT_CHECKER:
			"Verify factual claims and source quality. Mark claims as verified, unverified, false, or opinion. Your factual determinations override other specialists in final synthesis.",
		SUMMARIZER:
			"Condense the supplied material without introducing new claims. Preserve essential caveats, decisions, and action items.",
		TOOL_EXECUTOR:
			"Plan or execute only permitted tools. For each intended call provide tool name, parameters as JSON, expected return schema, and timeout no greater than 30 seconds. Available tool names: web_search, database_query, calculator, file_reader, api_caller, email_sender. Never state that a tool succeeded unless a real tool result is available.",
		CRITIC:
			"Adversarially review quality, security, compliance, assumptions, edge cases, and failure modes. Classify issues by severity. Your security and quality concerns override convenience in final synthesis.",
	};
	return `${shared}\n\nAssignment:\n${instructions[role]}`;
}

function specialistOutputContract(role: SpecialistAgentId) {
	return {
		format: "json" as const,
		strict: true,
		schema: {
			type: "object" as const,
			required: [
				"summary",
				"content",
				"confidence",
				"claims",
				"caveats",
				"sources",
				...(role === "TOOL_EXECUTOR" ? ["toolCalls"] : []),
			],
			additionalProperties: true,
			properties: {
				summary: { type: "string" as const, minLength: 1 },
				content: { type: "string" as const, minLength: 1 },
				confidence: { type: "number" as const, minimum: 0, maximum: 100 },
				claims: {
					type: "array" as const,
					items: {
						type: "object" as const,
						additionalProperties: true,
						properties: {
							text: { type: "string" as const },
							status: {
								type: "string" as const,
								enum: ["verified", "unverified", "false", "opinion"],
							},
						},
					},
				},
				caveats: { type: "array" as const, items: { type: "string" as const } },
				sources: {
					type: "array" as const,
					items: {
						type: "object" as const,
						additionalProperties: true,
						properties: {
							title: { type: "string" as const },
							url: { type: "string" as const },
							publishedAt: { type: "string" as const },
							authority: {
								type: "string" as const,
								enum: ["primary", "authoritative", "secondary", "unknown"],
							},
						},
					},
				},
				toolCalls: {
					type: "array" as const,
					items: {
						type: "object" as const,
						additionalProperties: true,
						required: ["tool", "parameters", "expectedReturnSchema", "timeoutSeconds"],
						properties: {
							tool: {
								type: "string" as const,
								enum: [
									"web_search",
									"database_query",
									"calculator",
									"file_reader",
									"api_caller",
									"email_sender",
								],
							},
							parameters: { type: "object" as const },
							expectedReturnSchema: { type: "object" as const },
							timeoutSeconds: {
								type: "number" as const,
								minimum: 1,
								maximum: 30,
							},
						},
					},
				},
				issues: {
					type: "array" as const,
					items: {
						type: "object" as const,
						additionalProperties: true,
						properties: {
							severity: {
								type: "string" as const,
								enum: ["low", "medium", "high", "critical"],
							},
							message: { type: "string" as const },
						},
					},
				},
			},
		},
	};
}

function normalizeContribution(run: AgentRun, subtask: ChristinaSubtask): ChristinaSpecialistContribution {
	const structured =
		run.structuredOutput && typeof run.structuredOutput === "object"
			? (run.structuredOutput as Record<string, unknown>)
			: undefined;
	const confidence =
		typeof structured?.confidence === "number"
			? Math.max(0, Math.min(100, structured.confidence))
			: run.status === "completed"
				? 70
				: 0;
	const sources = Array.isArray(structured?.sources)
		? structured.sources
				.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
				.map<ChristinaSource>((item) => ({
					title: typeof item.title === "string" ? item.title : "Untitled source",
					url: typeof item.url === "string" ? item.url : undefined,
					publishedAt:
						typeof item.publishedAt === "string" ? item.publishedAt : undefined,
					authority:
						item.authority === "primary" ||
						item.authority === "authoritative" ||
						item.authority === "secondary"
							? item.authority
							: "unknown",
				}))
		: [];
	return {
		subtaskId: subtask.id,
		agentId: subtask.agentId,
		runId: run.id,
		runtimeId: run.runtimeId,
		model: run.preparedRun.model,
		localModelScore:
			typeof run.preparedRun.metadata?.localModelScore === "number"
				? run.preparedRun.metadata.localModelScore
				: undefined,
		status: run.status === "completed" ? "completed" : "failed",
		output: run.outputText ?? "",
		structuredOutput: structured,
		confidence,
		sources,
		error: run.error?.message,
		completedAt: run.completedAt ?? new Date().toISOString(),
	};
}

function sourceScore(sources: ChristinaSource[]): number {
	if (sources.length === 0) return 5;
	const authority = sources.reduce((sum, source) => {
		if (source.authority === "primary") return sum + 1;
		if (source.authority === "authoritative") return sum + 0.9;
		if (source.authority === "secondary") return sum + 0.55;
		return sum + 0.2;
	}, 0) / sources.length;
	const dated = sources.filter((source) => source.publishedAt).length / sources.length;
	return Math.round(Math.min(15, authority * 12 + dated * 3));
}

function confidenceFor(
	plan: ChristinaRoutePlan,
	contributions: ChristinaSpecialistContribution[],
): ChristinaConfidence {
	const completed = contributions.filter((item) => item.status === "completed");
	const completion = Math.round((completed.length / Math.max(1, plan.subtasks.length)) * 25);
	const averageConfidence =
		completed.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, completed.length);
	const consensus = Math.round(Math.min(25, averageConfidence * 0.25));
	const factChecker = completed.find((item) => item.agentId === "FACT_CHECKER");
	const verification = factChecker
		? Math.round(Math.min(25, factChecker.confidence * 0.25))
		: plan.requiresFactChecking
			? 0
			: 15;
	const sources = sourceScore(completed.flatMap((item) => item.sources));
	const critic = completed.find((item) => item.agentId === "CRITIC");
	const criticalIssues = Array.isArray(critic?.structuredOutput?.issues)
		? (critic?.structuredOutput?.issues as unknown[]).filter(
				(item) =>
					item &&
					typeof item === "object" &&
					(item as Record<string, unknown>).severity === "critical",
			).length
		: 0;
	const quality = critic ? Math.max(0, 10 - criticalIssues * 5) : 5;
	const score = Math.max(0, Math.min(100, completion + consensus + verification + sources + quality));
	return {
		score,
		completion,
		consensus,
		factCheckerVerification: verification,
		sourceRecencyAndAuthority: sources,
		criticQuality: quality,
		needsClarification: score < 70,
		reasons: [
			`${completed.length}/${plan.subtasks.length} specialist tasks completed.`,
			factChecker
				? `FACT_CHECKER confidence was ${factChecker.confidence}%.`
				: plan.requiresFactChecking
					? "Fact-checking was required but not completed."
					: "No dedicated fact-check was required by routing.",
			`${completed.flatMap((item) => item.sources).length} source records were supplied.`,
			criticalIssues > 0 ? `${criticalIssues} critical issue(s) remain.` : "No critical issue was reported.",
		],
	};
}

function escaped(text: string, max = 24_000): string {
	return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated by orchestrator]`;
}

function synthesisPrompt(orchestration: ChristinaOrchestration): string {
	const contributions = orchestration.contributions
		.map(
			(item) =>
				`## ${item.agentId}\nStatus: ${item.status}\nConfidence: ${item.confidence}%\n\n${escaped(
					item.output || JSON.stringify(item.structuredOutput ?? {}, null, 2),
				)}`,
		)
		.join("\n\n");
	const confidence = orchestration.confidence;
	return `You are CHRISTINA, the Orchestrator. Synthesize the specialist outputs into one cohesive final answer for the user.\n\nOriginal request:\n${orchestration.originalRequest}\n\nComputed confidence: ${confidence?.score ?? 0}%\nConfidence reasons:\n${(confidence?.reasons ?? []).map((reason) => `- ${reason}`).join("\n")}\n\nConflict rules:\n1. FACT_CHECKER overrides factual claims.\n2. CRITIC overrides on security, quality, and serious risk concerns.\n3. The user's original intent is the final tiebreaker.\n\nRequirements:\n- Present the usable final answer, not a transcript.\n- Briefly acknowledge which specialists contributed.\n- State disagreements or unresolved caveats.\n- Do not invent missing facts or claim unperformed tool actions.\n- If confidence is below 70, explicitly identify the clarification needed.\n\nSpecialist outputs:\n${contributions}`;
}

function fallbackSynthesis(orchestration: ChristinaOrchestration): string {
	const byRole = new Map(orchestration.contributions.map((item) => [item.agentId, item]));
	const main =
		byRole.get("SUMMARIZER") ??
		byRole.get("FACT_CHECKER") ??
		byRole.get("CODER") ??
		byRole.get("RESEARCHER") ??
		orchestration.contributions[0];
	const caveats = orchestration.contributions.flatMap((item) => {
		const value = item.structuredOutput?.caveats;
		return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
	});
	const sections = [main?.output || String(main?.structuredOutput?.content ?? "No specialist output was produced.")];
	const fact = byRole.get("FACT_CHECKER");
	if (fact && fact !== main) sections.push(`\n### Fact-check\n${fact.output}`);
	const critic = byRole.get("CRITIC");
	if (critic && critic !== main) sections.push(`\n### Review caveats\n${critic.output}`);
	if (caveats.length > 0) sections.push(`\n### Caveats\n${unique(caveats).map((item) => `- ${item}`).join("\n")}`);
	sections.push(
		`\n### Specialist contributions\n${orchestration.contributions
			.map((item) => `- ${item.agentId}: ${item.status}`)
			.join("\n")}`,
	);
	return sections.join("\n");
}

export function renderRoutingLog(plan: ChristinaRoutePlan): string {
	return `<details>\n<summary>[ROUTING LOG]</summary>\n\n${plan.subtasks
		.map(
			(task) =>
				`- \`${task.agentId}\` — ${task.title}${
					task.dependencies.length > 0
						? `; waits for ${task.dependencies.map((id) => `\`${id}\``).join(", ")}`
						: "; runs in the first parallel stage"
				}`,
		)
		.join("\n")}\n\nMaximum specialist responses: ${plan.maxSpecialistResponses}.\n\n</details>`;
}

function finalizeResponse(
	routingLog: string,
	synthesis: string,
	confidence: ChristinaConfidence,
): string {
	const confidenceLine = `**Confidence: ${confidence.score}%**`;
	const clarification = confidence.needsClarification
		? `\n\n**Clarification needed:** The available specialist evidence did not reach the 70% confidence threshold. Review these gaps: ${confidence.reasons.join(" ")}`
		: "";
	return `${routingLog}\n\n${synthesis.trim()}\n\n${confidenceLine}${clarification}`;
}

export class ChristinaOrchestrator {
	private readonly active = new Map<string, Promise<void>>();
	private readonly activeRunIds = new Map<string, Set<string>>();

	constructor(private readonly kernel: AgentKernel) {}

	route(input: Pick<ChristinaOrchestrationInput, "request" | "explicitAgents">): ChristinaRoutePlan {
		const roles = selectedRoles(input.request, input.explicitAgents);
		const idByRole = new Map<SpecialistAgentId, string>();
		for (const role of roles) idByRole.set(role, randomUUID());
		const subtasks: ChristinaSubtask[] = roles.map((role) => ({
			id: idByRole.get(role) as string,
			agentId: role,
			title: `${role.replaceAll("_", " ")} contribution`,
			prompt: rolePrompt(role, input.request),
			dependencies: dependenciesFor(role, roles).map((dependency) => idByRole.get(dependency) as string),
			status: "pending",
		}));
		return {
			id: randomUUID(),
			createdAt: new Date().toISOString(),
			maxSpecialistResponses: CHRISTINA_MAX_SPECIALIST_RESPONSES,
			requiresFactChecking: roles.includes("FACT_CHECKER"),
			subtasks,
			routingSummary: roles.map((role) => `${role}: ${CHRISTINA_SPECIALISTS[role].specialty}`),
		};
	}

	async start(input: ChristinaOrchestrationInput): Promise<ChristinaOrchestration> {
		const now = new Date().toISOString();
		const routePlan = this.route(input);
		const orchestration: ChristinaOrchestration = {
			id: randomUUID(),
			status: "running",
			originalRequest: input.request,
			workspaceId: input.workspaceId,
			cwd: input.cwd,
			safetyMode: input.safetyMode ?? "workspace",
			routePlan,
			routingLog: renderRoutingLog(routePlan),
			contributions: [],
			createdAt: now,
			updatedAt: now,
		};
		await this.kernel.store.putOrchestration(orchestration);
		const execution = this.consume(orchestration, input).finally(() => {
			this.active.delete(orchestration.id);
			this.activeRunIds.delete(orchestration.id);
		});
		this.active.set(orchestration.id, execution);
		return orchestration;
	}

	async wait(id: string, timeoutMs = 30 * 60_000): Promise<ChristinaOrchestration> {
		const execution = this.active.get(id);
		if (execution) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					execution,
					new Promise<never>((_, reject) => {
						timer = setTimeout(() => reject(new Error(`Orchestration timed out: ${id}`)), timeoutMs);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		}
		const orchestration = await this.kernel.store.getOrchestration(id);
		if (!orchestration) throw new Error(`Orchestration not found: ${id}`);
		return orchestration;
	}

	async cancel(id: string): Promise<void> {
		for (const runId of this.activeRunIds.get(id) ?? []) await this.kernel.cancel(runId);
		const orchestration = await this.kernel.store.getOrchestration(id);
		if (!orchestration) return;
		await this.kernel.store.putOrchestration({
			...orchestration,
			status: "cancelled",
			updatedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
		});
	}

	private async selectLocalModel(
		role: SpecialistAgentId | "ORCHESTRATOR",
		input: ChristinaOrchestrationInput,
		providerIds?: string[],
	): Promise<LocalModelSelection | undefined> {
		return this.kernel.localModels.select({
			agentId: role,
			request: input.request,
			providerIds: providerIds ?? input.localProviderIds,
			requiredContextTokens: 8_192,
			requiresStructuredOutput: role !== "ORCHESTRATOR",
			requiresTools: role === "TOOL_EXECUTOR",
			minimumScore: input.minimumLocalModelScore ?? 60,
			preferredModel:
				role === "ORCHESTRATOR"
					? input.synthesisModel
					: input.modelOverrides?.[role],
		});
	}

	private async resolveRuntime(
		role: SpecialistAgentId,
		input: ChristinaOrchestrationInput,
	): Promise<{ runtimeId: string; model?: string; localSelection?: LocalModelSelection }> {
		const requested = input.runtimeOverrides?.[role];
		const requestedModel = input.modelOverrides?.[role];
		if (requested && this.kernel.runtimes.has(requested)) {
			if (this.kernel.localModels.listProviders().some((provider) => provider.id === requested)) {
				if (requestedModel) return { runtimeId: requested, model: requestedModel };
				const localSelection = await this.selectLocalModel(role, input, [requested]);
				if (!localSelection) throw new Error(`No suitable local model was found for ${role} on ${requested}.`);
				return {
					runtimeId: localSelection.runtimeId,
					model: localSelection.model,
					localSelection,
				};
			}
			return { runtimeId: requested, model: requestedModel ?? CHRISTINA_SPECIALISTS[role].preferredModel };
		}

		const policy: LocalModelPolicy = input.localModelPolicy ?? "prefer-local";
		if (policy !== "cloud-first" && this.kernel.localModels.listProviders().length > 0) {
			const localSelection = await this.selectLocalModel(role, input);
			if (localSelection && (policy !== "balanced" || localSelection.score >= 78)) {
				return {
					runtimeId: localSelection.runtimeId,
					model: requestedModel ?? localSelection.model,
					localSelection,
				};
			}
			if (policy === "local-only") {
				throw new Error(`No local model met the minimum score for ${role}.`);
			}
		}

		const preferred = CHRISTINA_SPECIALISTS[role].preferredRuntimeId;
		if (this.kernel.runtimes.has(preferred)) {
			return { runtimeId: preferred, model: requestedModel ?? CHRISTINA_SPECIALISTS[role].preferredModel };
		}

		const localFallback = await this.selectLocalModel(role, input);
		if (localFallback) {
			return {
				runtimeId: localFallback.runtimeId,
				model: requestedModel ?? localFallback.model,
				localSelection: localFallback,
			};
		}

		const first = this.kernel.runtimes.list()[0];
		if (!first) throw new Error("No agent runtimes are registered.");
		return { runtimeId: first.id, model: requestedModel ?? CHRISTINA_SPECIALISTS[role].preferredModel };
	}

	private async consume(
		initial: ChristinaOrchestration,
		input: ChristinaOrchestrationInput,
	): Promise<void> {
		let orchestration = initial;
		const pending = new Map(orchestration.routePlan.subtasks.map((task) => [task.id, task]));
		const completed = new Set<string>();
		const failed = new Set<string>();
		const settled = new Set<string>();
		const activeRunIds = new Set<string>();
		this.activeRunIds.set(orchestration.id, activeRunIds);
		try {
			while (pending.size > 0) {
				const ready = [...pending.values()].filter((task) =>
					task.dependencies.every((dependency) => settled.has(dependency)),
				);
				if (ready.length === 0) {
					if (pending.size === 0) break;
					throw new Error("The orchestration graph cannot make progress.");
				}

				for (const task of ready) task.status = "running";
				orchestration.updatedAt = new Date().toISOString();
				await this.kernel.store.putOrchestration(orchestration);

				const stageResults = await Promise.all(
					ready.map(async (task) => {
						pending.delete(task.id);
						const dependencyOutputs = orchestration.contributions
							.filter((item) => task.dependencies.includes(item.subtaskId))
							.map((item) => `## ${item.agentId}\n${escaped(item.output, 12_000)}`)
							.join("\n\n");
						const resolvedRuntime = await this.resolveRuntime(task.agentId, input);
						const runRequest: StartRunRequest = {
							agentId: task.agentId,
							runtimeId: resolvedRuntime.runtimeId,
							workspaceId: input.workspaceId,
							cwd: input.cwd,
							prompt: `${task.prompt}${
								dependencyOutputs
									? `\n\nDependency outputs to inspect:\n${dependencyOutputs}`
									: ""
							}`,
							safetyMode: input.safetyMode ?? "workspace",
							model: resolvedRuntime.model,
							budget: input.specialistBudget,
							outputContract: specialistOutputContract(task.agentId),
							contextBlocks: input.contextBlocks,
							metadata: {
								orchestrationId: orchestration.id,
								subtaskId: task.id,
								specialistAgentId: task.agentId,
								localModelScore: resolvedRuntime.localSelection?.score,
								localModelReasons: resolvedRuntime.localSelection?.reasons,
							},
						};
						const started = await this.kernel.start(runRequest);
						activeRunIds.add(started.id);
						const finished = await this.kernel.waitForRun(started.id, input.specialistTimeoutMs);
						activeRunIds.delete(started.id);
						return { task, contribution: normalizeContribution(finished, task) };
					}),
				);
				for (const result of stageResults) {
					orchestration.contributions.push(result.contribution);
					settled.add(result.task.id);
					if (result.contribution.status === "completed") {
						completed.add(result.task.id);
						result.task.status = "completed";
					} else {
						failed.add(result.task.id);
						result.task.status = "failed";
					}
				}
				orchestration = {
					...orchestration,
					updatedAt: new Date().toISOString(),
				};
				await this.kernel.store.putOrchestration(orchestration);
			}

			orchestration.confidence = confidenceFor(
				orchestration.routePlan,
				orchestration.contributions,
			);
			let synthesisRuntimeId =
				input.synthesisRuntimeId && this.kernel.runtimes.has(input.synthesisRuntimeId)
					? input.synthesisRuntimeId
					: undefined;
			let synthesisModel = input.synthesisModel;
			let synthesisLocalSelection: LocalModelSelection | undefined;
			const localPolicy: LocalModelPolicy = input.localModelPolicy ?? "prefer-local";
			if (!synthesisRuntimeId && localPolicy !== "cloud-first") {
				synthesisLocalSelection = await this.selectLocalModel("ORCHESTRATOR", input);
				if (
					synthesisLocalSelection &&
					(localPolicy !== "balanced" || synthesisLocalSelection.score >= 78)
				) {
					synthesisRuntimeId = synthesisLocalSelection.runtimeId;
					synthesisModel = synthesisModel ?? synthesisLocalSelection.model;
				}
			}
			if (!synthesisRuntimeId && localPolicy === "local-only") {
				throw new Error("No suitable local model was available for CHRISTINA synthesis.");
			}
			if (!synthesisRuntimeId && this.kernel.runtimes.has("openclaude")) {
				synthesisRuntimeId = "openclaude";
			}
			if (!synthesisRuntimeId && !synthesisLocalSelection) {
				synthesisLocalSelection = await this.selectLocalModel("ORCHESTRATOR", input);
				if (synthesisLocalSelection) {
					synthesisRuntimeId = synthesisLocalSelection.runtimeId;
					synthesisModel = synthesisModel ?? synthesisLocalSelection.model;
				}
			}
			if (synthesisRuntimeId) {
				const synthesisRun = await this.kernel.start({
					agentId: "ORCHESTRATOR",
					runtimeId: synthesisRuntimeId,
					workspaceId: input.workspaceId,
					cwd: input.cwd,
					prompt: synthesisPrompt(orchestration),
					safetyMode: "review" as AgentSafetyMode,
					model: synthesisModel,
					budget: input.synthesisBudget,
					outputContract: { format: "text" },
					metadata: {
						orchestrationId: orchestration.id,
						role: "ORCHESTRATOR",
						localModelScore: synthesisLocalSelection?.score,
						localModelReasons: synthesisLocalSelection?.reasons,
					},
				});
				activeRunIds.add(synthesisRun.id);
				const finished = await this.kernel.waitForRun(
					synthesisRun.id,
					input.synthesisTimeoutMs,
				);
				activeRunIds.delete(synthesisRun.id);
				orchestration.synthesisRunId = finished.id;
				orchestration.synthesis = finished.outputText || fallbackSynthesis(orchestration);
			} else {
				orchestration.synthesis = fallbackSynthesis(orchestration);
			}
			orchestration.finalResponse = finalizeResponse(
				orchestration.routingLog,
				orchestration.synthesis ?? "No synthesis was produced.",
				orchestration.confidence,
			);
			orchestration.status = failed.size > 0 ? "partial" : "completed";
			orchestration.completedAt = new Date().toISOString();
			orchestration.updatedAt = orchestration.completedAt;
			await this.kernel.store.putOrchestration(orchestration);
		} catch (error) {
			orchestration = {
				...orchestration,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
				updatedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
			};
			await this.kernel.store.putOrchestration(orchestration);
		}
	}
}
