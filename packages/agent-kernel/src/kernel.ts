import { randomUUID } from "node:crypto";
import {
	createBudgetState,
	findExceededBudget,
	updateBudgetState,
	updateDuration,
} from "./budget";
import { BookLibraryService } from "./book-libraries";
import { CheckpointService } from "./checkpoints";
import { ContextEngine } from "./context";
import { RuntimeDoctorService } from "./diagnostics";
import { EventFactory } from "./events";
import { HookEngine, type HookEventReporter } from "./hooks";
import { SessionMailboxService } from "./mailbox";
import { LocalModelService, type LocalModelProvider } from "./local-models";
import { MemoryService } from "./memory";
import { ChristinaOrchestrator } from "./orchestration";
import { DefaultPolicyEngine, type PolicyEngine } from "./policy";
import { type AgentRuntimeAdapter, RuntimeRegistry } from "./runtime";
import { SkillService } from "./skills";
import type { AgentKernelStore } from "./store";
import { validateOutput, validateStructuredValue } from "./structured-output";
import { TaskGraphService } from "./task-graph";
import { ToolGateway } from "./tools";
import type {
	AgentEvent,
	AgentRun,
	AgentSafetyMode,
	AgentSession,
	ApprovalRecord,
	ContextBlock,
	HookExecutionResult,
	OutputContract,
	PolicyOperation,
	PreparedRun,
	RunBudget,
	AskKnowledgeAgentRequest,
	AskKnowledgeAgentResult,
} from "./types";

export interface StartRunRequest {
	sessionId?: string;
	agentId: string;
	runtimeId: string;
	workspaceId: string;
	cwd: string;
	prompt: string;
	safetyMode?: AgentSafetyMode;
	model?: string;
	contextBlocks?: ContextBlock[];
	contextBudget?: number;
	contextReserve?: number;
	env?: Record<string, string>;
	metadata?: Record<string, unknown>;
	budget?: RunBudget;
	outputContract?: OutputContract;
	includeQueuedMessages?: boolean;
	checkpointBeforeRun?: boolean;
	checkpointAfterRun?: boolean;
	bookLibraryIds?: string[];
	bookQuery?: string;
	bookMaxChunks?: number;
	bookMaxContextTokens?: number;
}

type EventPayload = AgentEvent extends infer Event
	? Event extends AgentEvent
		? Omit<Event, "id" | "runId" | "sequence" | "timestamp">
		: never
	: never;

function hookContextBlocks(
	prefix: string,
	result: HookExecutionResult | undefined,
): ContextBlock[] {
	return (result?.additionalContexts ?? []).map((content, index) => ({
		id: `${prefix}-${index + 1}`,
		kind: "hook" as const,
		priority: 94,
		pinned: true,
		content,
		source: "host-hook",
	}));
}

function applyHookPrompt(prompt: string, ...results: Array<HookExecutionResult | undefined>): string {
	const initial = results.flatMap((result) => result?.initialUserMessages ?? []);
	let updated = prompt;
	for (const result of results) {
		if (typeof result?.updatedInput === "string") updated = result.updatedInput;
		else if (
			result?.updatedInput &&
			typeof result.updatedInput === "object" &&
			"prompt" in result.updatedInput &&
			typeof (result.updatedInput as { prompt?: unknown }).prompt === "string"
		) {
			updated = (result.updatedInput as { prompt: string }).prompt;
		}
	}
	return [...initial, updated].filter(Boolean).join("\n\n");
}

export class AgentKernel {
	readonly runtimes = new RuntimeRegistry();
	readonly context = new ContextEngine();
	readonly hooks = new HookEngine();
	readonly localModels = new LocalModelService();
	readonly books: BookLibraryService;
	readonly memory: MemoryService;
	readonly skills: SkillService;
	readonly tasks: TaskGraphService;
	readonly tools: ToolGateway;
	readonly mailbox: SessionMailboxService;
	readonly checkpoints: CheckpointService;
	readonly doctor: RuntimeDoctorService;
	readonly orchestrator: ChristinaOrchestrator;
	private readonly activeRuns = new Map<string, Promise<void>>();
	private readonly cancellationRequested = new Set<string>();

	constructor(
		readonly store: AgentKernelStore,
		readonly policy: PolicyEngine = new DefaultPolicyEngine(),
	) {
		this.books = new BookLibraryService(store);
		this.memory = new MemoryService(store);
		this.skills = new SkillService(store);
		this.tasks = new TaskGraphService(store);
		this.mailbox = new SessionMailboxService(store);
		this.checkpoints = new CheckpointService(store, this.hooks);
		this.tools = new ToolGateway({
			policy,
			hooks: this.hooks,
			requestApproval: (input) => this.requestApproval(input),
		});
		this.doctor = new RuntimeDoctorService(this.runtimes);
		this.orchestrator = new ChristinaOrchestrator(this);
	}

	async initialize(): Promise<void> {
		await this.store.initialize();
		await this.recoverInterruptedRuns();
		await this.recoverInterruptedOrchestrations();
		await this.recoverClaimedMessages();
	}

	private async recoverInterruptedRuns(): Promise<void> {
		const runs = await this.store.listRuns();
		const now = new Date().toISOString();
		await Promise.all(
			runs
				.filter((run) =>
					["queued", "running", "waiting_for_approval", "waiting_for_input"].includes(
						run.status,
					),
				)
				.map((run) =>
					this.store.putRun({
						...run,
						status: "failed",
						budgetState: run.budgetState ?? createBudgetState(run.startedAt),
						completedAt: now,
						updatedAt: now,
						error: {
							code: "host_restarted",
							message: "The CHRISTINA host restarted before this run completed.",
							retryable: true,
						},
					}),
				),
		);
	}

	private async recoverInterruptedOrchestrations(): Promise<void> {
		const orchestrations = await this.store.listOrchestrations();
		const now = new Date().toISOString();
		await Promise.all(
			orchestrations
				.filter((orchestration) => orchestration.status === "running")
				.map((orchestration) =>
					this.store.putOrchestration({
						...orchestration,
						status: "failed",
						error: "The CHRISTINA host restarted before orchestration completed.",
						updatedAt: now,
						completedAt: now,
					}),
				),
		);
	}

	private async recoverClaimedMessages(): Promise<void> {
		const messages = await this.store.listMessages();
		const now = new Date().toISOString();
		await Promise.all(
			messages
				.filter((message) => message.status === "claimed")
				.map((message) =>
					this.store.putMessage({
						...message,
						status: "queued",
						claimedAt: undefined,
						updatedAt: now,
					}),
				),
		);
	}

	registerRuntime(adapter: AgentRuntimeAdapter): void {
		this.runtimes.register(adapter);
	}

	registerLocalModelProvider(provider: LocalModelProvider): void {
		this.localModels.register(provider);
		this.runtimes.register(provider);
	}

	evaluate(operation: PolicyOperation, workspaceRoot: string) {
		return this.policy.evaluate(operation, workspaceRoot);
	}

	async requestApproval(input: {
		runId: string;
		operation: PolicyOperation;
		workspaceRoot: string;
	}): Promise<ApprovalRecord> {
		const run = await this.store.getRun(input.runId);
		if (!run) throw new Error(`Run not found: ${input.runId}`);
		let decision = this.policy.evaluate(input.operation, input.workspaceRoot);
		const hook = await this.hooks.execute({
			event: "permission.request",
			runId: run.id,
			sessionId: run.sessionId,
			agentId: input.operation.agentId,
			runtimeId: run.runtimeId,
			workspaceId: input.operation.workspaceId,
			workspaceRoot: input.workspaceRoot,
			operation: input.operation,
			payload: { decision },
		});
		if (hook.permissionDecision === "deny") {
			decision = {
				result: "deny",
				reason: hook.reason ?? "A host hook denied this request.",
				ruleId: "hook.permission-deny",
				riskLevel: decision.riskLevel,
			};
		} else if (hook.permissionDecision === "allow" && decision.result !== "deny") {
			decision = {
				result: "allow",
				reason: hook.reason ?? "A trusted host hook approved this request.",
				ruleId: "hook.permission-allow",
				riskLevel: decision.riskLevel,
			};
		}
		const approval: ApprovalRecord = {
			id: randomUUID(),
			runId: run.id,
			sessionId: run.sessionId,
			operation: input.operation,
			decision,
			status:
				decision.result === "allow"
					? "approved"
					: decision.result === "deny"
						? "denied"
						: "pending",
			requestedAt: new Date().toISOString(),
		};
		await this.store.putApproval(approval);
		if (approval.status === "pending") {
			await this.store.putRun({
				...run,
				status: "waiting_for_approval",
				budgetState: run.budgetState ?? createBudgetState(run.startedAt),
				updatedAt: new Date().toISOString(),
			});
		}
		return approval;
	}

	async resolveApproval(input: {
		id: string;
		approved: boolean;
		resolvedBy: string;
		note?: string;
	}): Promise<ApprovalRecord> {
		const approval = await this.store.getApproval(input.id);
		if (!approval) throw new Error(`Approval not found: ${input.id}`);
		if (approval.status !== "pending") return approval;
		const updated: ApprovalRecord = {
			...approval,
			status: input.approved ? "approved" : "denied",
			resolvedAt: new Date().toISOString(),
			resolvedBy: input.resolvedBy,
			note: input.note,
		};
		await this.store.putApproval(updated);
		const run = await this.store.getRun(approval.runId);
		if (run && run.status === "waiting_for_approval") {
			await this.store.putRun({
				...run,
				status: input.approved && this.isActive(run.id) ? "running" : run.status,
				updatedAt: new Date().toISOString(),
			});
		}
		return updated;
	}

	async start(request: StartRunRequest): Promise<AgentRun> {
		const now = new Date().toISOString();
		const runId = randomUUID();
		let session: AgentSession | undefined;
		if (request.sessionId) session = await this.store.getSession(request.sessionId);
		const isNewSession = !session;
		if (!session) {
			session = {
				id: request.sessionId ?? randomUUID(),
				agentId: request.agentId,
				workspaceId: request.workspaceId,
				runtimeSessionIds: {},
				status: "active",
				createdAt: now,
				lastActiveAt: now,
			};
		} else {
			session = { ...session, lastActiveAt: now, status: "active" };
		}
		await this.store.putSession(session);

		const sessionHook = isNewSession
			? await this.hooks.execute({
					event: "session.start",
					runId,
					sessionId: session.id,
					agentId: request.agentId,
					runtimeId: request.runtimeId,
					workspaceId: request.workspaceId,
					workspaceRoot: request.cwd,
					payload: { prompt: request.prompt },
				})
			: undefined;
		const runHook = await this.hooks.execute({
			event: "run.before",
			runId,
			sessionId: session.id,
			agentId: request.agentId,
			runtimeId: request.runtimeId,
			workspaceId: request.workspaceId,
			workspaceRoot: request.cwd,
			payload: { prompt: request.prompt, safetyMode: request.safetyMode ?? "workspace" },
		});
		const claimedMessages =
			request.includeQueuedMessages === false
				? []
				: await this.mailbox.claimBatch(session.id);
		const mailboxBlock = this.mailbox.toContextBlock(claimedMessages);
		const prompt = applyHookPrompt(request.prompt, sessionHook, runHook);
		const privateBooks = request.bookLibraryIds?.length
			? await this.books.contextForAgent({
				agentId: request.agentId,
				query: request.bookQuery ?? request.prompt,
				libraryIds: request.bookLibraryIds,
				maxResults: request.bookMaxChunks,
				maxTokens: request.bookMaxContextTokens,
			})
			: { results: [], block: undefined };
		const context = this.context.build({
			blocks: [
				...(request.contextBlocks ?? []),
				...(privateBooks.block ? [privateBooks.block] : []),
				...hookContextBlocks("session-hook", sessionHook),
				...hookContextBlocks("run-hook", runHook),
				...(mailboxBlock ? [mailboxBlock] : []),
			],
			budget: request.contextBudget,
			reserve: request.contextReserve,
		});
		const preparedRun: PreparedRun = {
			id: runId,
			sessionId: session.id,
			runtimeId: request.runtimeId,
			workspaceId: request.workspaceId,
			cwd: request.cwd,
			prompt,
			safetyMode: request.safetyMode ?? "workspace",
			model: request.model,
			context,
			env: request.env,
			budget: request.budget,
			outputContract: request.outputContract,
			metadata: {
				...(request.metadata ?? {}),
				agentId: request.agentId,
				mailboxMessageIds: claimedMessages.map((message) => message.id),
				checkpointBeforeRun: request.checkpointBeforeRun ?? false,
				checkpointAfterRun: request.checkpointAfterRun ?? false,
				privateBookLibraryIds: request.bookLibraryIds ?? [],
				privateBookCitations: privateBooks.results.map((result) => result.citation),
				hookAnnotations: {
					...(sessionHook?.annotations ?? {}),
					...(runHook.annotations ?? {}),
				},
			},
			createdAt: now,
		};
		const previousRuns = await this.store.listRuns(session.id);
		const blocked = sessionHook?.continue === false || runHook.continue === false;
		const run: AgentRun = {
			id: runId,
			sessionId: session.id,
			runtimeId: request.runtimeId,
			attempt: previousRuns.length + 1,
			status: blocked ? "failed" : "queued",
			preparedRun,
			usage: {},
			budgetState: createBudgetState(),
			error: blocked
				? {
						code: "hook_blocked",
						message:
							runHook.reason ??
							sessionHook?.reason ??
							"A host lifecycle hook blocked the run.",
						retryable: false,
					}
				: undefined,
			completedAt: blocked ? now : undefined,
			createdAt: now,
			updatedAt: now,
		};
		await this.store.putRun(run);
		if (blocked) {
			await this.mailbox.release(claimedMessages.map((message) => message.id));
			return run;
		}

		const execution = this.consume(run).finally(() =>
			this.activeRuns.delete(run.id),
		);
		this.activeRuns.set(run.id, execution);
		return run;
	}


	async createKnowledgeAgent(input: {
		name: string;
		runtimeId: string;
		model: string;
		libraryIds: string[];
		teachingStyle?: "socratic" | "direct" | "step-by-step" | "exam-prep";
		localOnly?: boolean;
		metadata?: Record<string, unknown>;
	}) {
		const localOnly = input.localOnly ?? true;
		if (localOnly && !this.localModels.listProviders().some((provider) => provider.id === input.runtimeId)) {
			throw new Error(`Private knowledge agent ${input.name} must use a registered local-model provider. Runtime ${input.runtimeId} is not local.`);
		}
		if (!this.runtimes.has(input.runtimeId)) throw new Error(`Runtime is not registered: ${input.runtimeId}`);
		return this.books.createKnowledgeAgent({ ...input, localOnly });
	}

	async askKnowledgeAgent(request: AskKnowledgeAgentRequest): Promise<AskKnowledgeAgentResult> {
		const profile = await this.books.getKnowledgeAgent(request.agentProfileId);
		if (!profile) throw new Error(`Knowledge agent not found: ${request.agentProfileId}`);
		if (profile.status !== "active") throw new Error(`Knowledge agent is disabled: ${profile.name}`);
		if (profile.localOnly !== false && !this.localModels.listProviders().some((provider) => provider.id === profile.runtimeId)) {
			throw new Error(`Knowledge agent ${profile.name} is local-only, but runtime ${profile.runtimeId} is not a registered local provider.`);
		}
		if (!this.runtimes.has(profile.runtimeId)) throw new Error(`Runtime is not registered: ${profile.runtimeId}`);
		const privateContext = await this.books.contextForAgent({
			agentId: profile.id,
			query: request.question,
			libraryIds: profile.libraryIds,
			maxResults: request.maxChunks ?? 10,
			maxTokens: request.maxContextTokens ?? 10_000,
		});
		if (!privateContext.block) {
			throw new Error("No relevant passages were found in the assigned books. Scan the library or ask a more specific question.");
		}
		const mode = request.mode ?? "answer";
		const modeInstruction = {
			answer: "Answer the question directly and explain the reasoning clearly.",
			teach: `Teach the material in a ${profile.teachingStyle} style. Start with the core idea, then examples, then a short comprehension check.`,
			quiz: "Create a quiz based only on the retrieved passages. Do not reveal answers until after the questions.",
			"study-guide": "Create a structured study guide with key ideas, definitions, examples, and review questions.",
		}[mode];
		const prompt = `${modeInstruction}\n\nQuestion or learning goal:\n${request.question}\n\nRules:\n- Use only the assigned private-book context for claims about the books.\n- Cite every book-specific claim with [BOOK n].\n- Say when the retrieved passages are insufficient.\n- Never claim to have permanently trained on or memorized the entire book.`;
		const started = await this.start({
			agentId: profile.id,
			runtimeId: profile.runtimeId,
			workspaceId: request.workspaceId ?? `book-agent-${profile.id}`,
			cwd: request.cwd ?? process.cwd(),
			prompt,
			safetyMode: request.safetyMode ?? "review",
			model: profile.model,
			budget: request.budget,
			contextBlocks: [
				{
					id: "private-book-agent",
					kind: "agent",
					priority: 100,
					pinned: true,
					content: `You are ${profile.name}, a private local book tutor. Your book access is restricted to the libraries explicitly assigned to this profile. Do not request or infer access to other libraries.`,
				},
				privateContext.block,
			],
			metadata: {
				knowledgeAgentProfileId: profile.id,
				privateBookLibraryIds: profile.libraryIds,
				privateBookCitations: privateContext.results.map((result) => result.citation),
				mode,
			},
		});
		const run = await this.waitForRun(started.id);
		return {
			run,
			profile,
			results: privateContext.results,
			citations: privateContext.results.map((result) => result.citation),
		};
	}

	async cancel(runId: string): Promise<void> {
		const run = await this.store.getRun(runId);
		if (!run) throw new Error(`Run not found: ${runId}`);
		this.cancellationRequested.add(runId);
		await this.runtimes.get(run.runtimeId).cancel(runId);
		const now = new Date().toISOString();
		await this.store.putRun({
			...run,
			status: "cancelled",
			budgetState: run.budgetState ?? createBudgetState(run.startedAt),
			completedAt: now,
			updatedAt: now,
		});
	}

	isActive(runId: string): boolean {
		return this.activeRuns.has(runId);
	}

	async waitForRun(runId: string, timeoutMs = 30 * 60_000): Promise<AgentRun> {
		const execution = this.activeRuns.get(runId);
		if (execution) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					execution,
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error(`Run timed out: ${runId}`)),
							timeoutMs,
						);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		}
		const run = await this.store.getRun(runId);
		if (!run) throw new Error(`Run not found: ${runId}`);
		return run;
	}

	private async consume(run: AgentRun): Promise<void> {
		const adapter = this.runtimes.get(run.runtimeId);
		const startedAt = new Date().toISOString();
		const factory = new EventFactory(run.id);
		const append = async (payload: EventPayload): Promise<AgentEvent> => {
			const event = factory.create(payload);
			await this.store.appendEvent(event);
			return event;
		};
		const reporter: HookEventReporter = {
			started: async (hookId, event) => {
				await append({ type: "hook.started", hookId, event });
			},
			completed: async (hookId, event, durationMs) => {
				await append({ type: "hook.completed", hookId, event, durationMs });
			},
			failed: async (hookId, event, error) => {
				await append({ type: "hook.failed", hookId, event, error });
			},
		};
		let current: AgentRun = {
			...run,
			status: "running",
			startedAt,
			budgetState: createBudgetState(startedAt),
			updatedAt: startedAt,
		};
		await this.store.putRun(current);
		if (run.preparedRun.context.compactions.length > 0) {
			await append({
				type: "context.compacted",
				records: run.preparedRun.context.compactions,
			});
		}

		const mailboxMessageIds = Array.isArray(
			run.preparedRun.metadata?.mailboxMessageIds,
		)
			? (run.preparedRun.metadata?.mailboxMessageIds as unknown[]).filter(
					(value): value is string => typeof value === "string",
				)
			: [];
		let outputText = "";
		let runtimeStructuredOutput: unknown;
		let terminalCompleted: Extract<AgentEvent, { type: "run.completed" }> | undefined;
		let budgetExceeded = current.budgetState.exceeded;
		let budgetEventWritten = false;
		let durationTimer: ReturnType<typeof setTimeout> | undefined;
		if (run.preparedRun.budget?.maxDurationMs !== undefined) {
			durationTimer = setTimeout(() => {
				const allowed = run.preparedRun.budget?.maxDurationMs ?? 0;
				budgetExceeded = {
					limit: "maxDurationMs",
					actual: Date.now() - Date.parse(startedAt),
					allowed,
					at: new Date().toISOString(),
				};
				void adapter.cancel(run.id);
			}, run.preparedRun.budget.maxDurationMs + 1);
		}

		try {
			if (run.preparedRun.metadata?.checkpointBeforeRun === true) {
				const checkpoint = await this.checkpoints.create({
					runId: run.id,
					sessionId: run.sessionId,
					workspaceId: run.preparedRun.workspaceId,
					workspaceRoot: run.preparedRun.cwd,
					label: `Before run ${run.attempt}`,
					reason: "Automatic pre-run checkpoint",
				});
				await append({ type: "checkpoint.created", checkpointId: checkpoint.id });
			}

			const session = await this.store.getSession(run.sessionId);
			const runtimeSessionId = session?.runtimeSessionIds[run.runtimeId];
			const runtimeStream =
				runtimeSessionId && adapter.resume
					? adapter.resume(runtimeSessionId, run.preparedRun)
					: adapter.start(run.preparedRun);

			for await (const runtimeEvent of runtimeStream) {
				const now = new Date().toISOString();
				current = {
					...current,
					budgetState: updateDuration(
						updateBudgetState(current.budgetState, runtimeEvent),
					),
					updatedAt: now,
				};
				if (runtimeEvent.type === "assistant.delta") {
					outputText += runtimeEvent.text;
				}
				if (runtimeEvent.type === "runtime.structured_output") {
					runtimeStructuredOutput = runtimeEvent.value;
				}
				if (runtimeEvent.type === "runtime.session" && session) {
					session.runtimeSessionIds[runtimeEvent.runtimeId] = runtimeEvent.runtimeSessionId;
					session.lastActiveAt = now;
					await this.store.putSession(session);
				}
				const exceeded =
					budgetExceeded ??
					findExceededBudget(run.preparedRun.budget, current.budgetState);
				if (exceeded && !budgetExceeded) {
					budgetExceeded = exceeded;
					current = {
						...current,
						budgetState: { ...current.budgetState, exceeded },
					};
					await adapter.cancel(run.id);
				}

				if (runtimeEvent.type === "run.completed") {
					terminalCompleted = runtimeEvent;
				} else if (budgetExceeded && ["run.failed", "run.cancelled"].includes(runtimeEvent.type)) {
					// The host budget decision becomes the authoritative terminal result.
				} else {
					await this.store.appendEvent(factory.resequence(runtimeEvent));
				}

				if (runtimeEvent.type === "usage.updated") {
					current = {
						...current,
						usage: { ...current.usage, ...runtimeEvent.usage },
					};
				}
				if (
					runtimeEvent.type === "usage.updated" ||
					runtimeEvent.type === "tool.requested" ||
					runtimeEvent.type === "turn.completed"
				) {
					await append({ type: "budget.updated", state: current.budgetState });
				}
				if (runtimeEvent.type === "run.failed") {
					current = {
						...current,
						status: "failed",
						error: runtimeEvent.error,
						completedAt: now,
					};
				}
				if (runtimeEvent.type === "run.cancelled") {
					current = {
						...current,
						status: "cancelled",
						completedAt: now,
					};
				}
				await this.store.putRun({ ...current, outputText });
			}

			current = {
				...current,
				budgetState: updateDuration(current.budgetState),
				outputText,
			};
			if (budgetExceeded) {
				current.budgetState = { ...current.budgetState, exceeded: budgetExceeded };
				await append({ type: "budget.exceeded", state: current.budgetState });
				budgetEventWritten = true;
				const error = {
					code: "budget_exceeded",
					message: `Run exceeded ${budgetExceeded.limit}: ${budgetExceeded.actual} > ${budgetExceeded.allowed}.`,
					retryable: false,
				};
				await append({ type: "run.failed", error });
				current = {
					...current,
					status: "failed",
					error,
					completedAt: new Date().toISOString(),
				};
			} else if (terminalCompleted) {
				const validation =
					runtimeStructuredOutput !== undefined
						? validateStructuredValue(
							runtimeStructuredOutput,
							run.preparedRun.outputContract,
							outputText.length,
						)
						: validateOutput(outputText, run.preparedRun.outputContract);
				if (validation) {
					await append({ type: "output.validated", result: validation });
					current = {
						...current,
						outputValidation: validation,
						structuredOutput: validation.value,
					};
				}
				if (
					validation &&
					!validation.valid &&
					run.preparedRun.outputContract?.strict
				) {
					const error = {
						code: "structured_output_invalid",
						message: validation.errors.join(" ") || "Structured output validation failed.",
						retryable: true,
					};
					await append({ type: "run.failed", error });
					current = {
						...current,
						status: "failed",
						error,
						completedAt: new Date().toISOString(),
					};
				} else {
					const outcome = validation && !validation.valid ? "partial" : terminalCompleted.outcome;
					await append({
						type: "run.completed",
						outcome,
						exitCode: terminalCompleted.exitCode,
					});
					current = {
						...current,
						status: "completed",
						completedAt: new Date().toISOString(),
					};
				}
			} else if (!["failed", "cancelled"].includes(current.status)) {
				const error = {
					code: "runtime_no_terminal_event",
					message: "The runtime ended without a normalized terminal event.",
					retryable: true,
				};
				await append({ type: "run.failed", error });
				current = {
					...current,
					status: "failed",
					error,
					completedAt: new Date().toISOString(),
				};
			}

			if (
				current.status === "completed" &&
				run.preparedRun.metadata?.checkpointAfterRun === true
			) {
				const checkpoint = await this.checkpoints.create({
					runId: run.id,
					sessionId: run.sessionId,
					workspaceId: run.preparedRun.workspaceId,
					workspaceRoot: run.preparedRun.cwd,
					label: `After run ${run.attempt}`,
					reason: "Automatic post-run checkpoint",
				});
				await append({ type: "checkpoint.created", checkpointId: checkpoint.id });
			}

			const lifecycleEvent = current.status === "completed" ? "run.after" : "run.error";
			const hookResult = await this.hooks.execute(
				{
					event: lifecycleEvent,
					runId: run.id,
					sessionId: run.sessionId,
					agentId: run.preparedRun.metadata?.agentId as string | undefined,
					runtimeId: run.runtimeId,
					workspaceId: run.preparedRun.workspaceId,
					workspaceRoot: run.preparedRun.cwd,
					payload: { run: current, outputText },
				},
				{ reporter },
			);
			if (current.error && hookResult.retry) {
				current.error = { ...current.error, retryable: true };
			}
			if (current.status === "completed") {
				await this.mailbox.markDelivered(mailboxMessageIds);
			} else {
				await this.mailbox.release(mailboxMessageIds);
			}
			current.updatedAt = new Date().toISOString();
			await this.store.putRun(current);
		} catch (error) {
			const now = new Date().toISOString();
			if (budgetExceeded && !budgetEventWritten) {
				current.budgetState = { ...updateDuration(current.budgetState), exceeded: budgetExceeded };
				await append({ type: "budget.exceeded", state: current.budgetState });
			}
			const normalized = {
				code: "kernel_execution_failed",
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			};
			await append({ type: "run.failed", error: normalized });
			current = {
				...current,
				status: this.cancellationRequested.has(run.id) ? "cancelled" : "failed",
				error: normalized,
				outputText,
				completedAt: now,
				updatedAt: now,
			};
			await this.mailbox.release(mailboxMessageIds);
			await this.store.putRun(current);
		} finally {
			if (durationTimer) clearTimeout(durationTimer);
			this.cancellationRequested.delete(run.id);
		}
	}

	async requestCheckpointRestoreApproval(input: {
		runId: string;
		checkpointId: string;
		agentId: string;
		safetyMode: AgentSafetyMode;
	}): Promise<ApprovalRecord> {
		const checkpoint = await this.store.getCheckpoint(input.checkpointId);
		if (!checkpoint) throw new Error(`Checkpoint not found: ${input.checkpointId}`);
		return this.requestApproval({
			runId: input.runId,
			workspaceRoot: checkpoint.workspaceRoot,
			operation: {
				agentId: input.agentId,
				workspaceId: checkpoint.workspaceId,
				safetyMode: input.safetyMode,
				category: "checkpoint.restore",
				target: checkpoint.id,
				reversible: false,
			},
		});
	}

	async restoreCheckpoint(input: {
		checkpointId: string;
		approvalId: string;
		allowIncomplete?: boolean;
	}): Promise<Awaited<ReturnType<CheckpointService["restore"]>>> {
		const approval = await this.store.getApproval(input.approvalId);
		if (
			!approval ||
			approval.status !== "approved" ||
			approval.operation.category !== "checkpoint.restore" ||
			approval.operation.target !== input.checkpointId
		) {
			throw new Error("An approved checkpoint-restore authorization is required.");
		}
		return this.checkpoints.restore({
			checkpointId: input.checkpointId,
			force: true,
			allowIncomplete: input.allowIncomplete,
		});
	}
}
