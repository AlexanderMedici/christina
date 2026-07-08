export type AgentSafetyMode = "review" | "workspace" | "unrestricted";
export type AgentRunStatus =
	| "queued"
	| "running"
	| "waiting_for_approval"
	| "waiting_for_input"
	| "paused"
	| "completed"
	| "failed"
	| "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PolicyResult = "allow" | "deny" | "require_approval";

export interface RuntimeCapabilities {
	resume: boolean;
	cancellation: boolean;
	structuredToolEvents: boolean;
	nativeApprovals: boolean;
	streaming: boolean;
	structuredOutput?: boolean;
	checkpoints?: boolean;
}

export interface RuntimeHealth {
	available: boolean;
	version?: string;
	detail?: string;
	latencyMs?: number;
}

export interface ContextBlock {
	id: string;
	kind:
		| "system"
		| "agent"
		| "project"
		| "memory"
		| "skill"
		| "transcript"
		| "task"
		| "workspace"
		| "policy"
		| "hook"
		| "mailbox";
	content: string;
	priority: number;
	source?: string;
	estimatedTokens?: number;
	/** Pinned blocks are selected before non-pinned blocks. */
	pinned?: boolean;
	/** Compactable blocks may be reduced rather than dropped. */
	compactable?: boolean;
	/** Maximum token allocation for this block during micro-compaction. */
	maxTokens?: number;
	createdAt?: string;
}

export interface ContextCompactionRecord {
	blockId: string;
	originalTokens: number;
	compactedTokens: number;
	strategy: "head_tail" | "transcript_tail" | "whitespace";
}

export interface ContextPackage {
	blocks: ContextBlock[];
	rendered: string;
	estimatedTokens: number;
	omittedBlockIds: string[];
	compactions: ContextCompactionRecord[];
	budget: number;
	reserve: number;
}

export interface RunBudget {
	maxDurationMs?: number;
	maxTurns?: number;
	maxCostUsd?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	maxTotalTokens?: number;
	maxToolCalls?: number;
	maxAssistantChars?: number;
}

export interface RunBudgetState {
	startedAt?: string;
	durationMs: number;
	turns: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
	toolCalls: number;
	assistantChars: number;
	exceeded?: {
		limit: keyof RunBudget;
		actual: number;
		allowed: number;
		at: string;
	};
}

export type JsonSchema = {
	type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
	description?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	enum?: unknown[];
	additionalProperties?: boolean;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
};

export interface OutputContract {
	format: "text" | "json";
	schema?: JsonSchema;
	strict?: boolean;
}

export interface OutputValidationResult {
	valid: boolean;
	format: "text" | "json";
	value?: unknown;
	errors: string[];
	rawTextLength: number;
}

export interface PreparedRun {
	id: string;
	sessionId: string;
	runtimeId: string;
	workspaceId: string;
	cwd: string;
	prompt: string;
	safetyMode: AgentSafetyMode;
	model?: string;
	context: ContextPackage;
	env?: Record<string, string>;
	metadata?: Record<string, unknown>;
	budget?: RunBudget;
	outputContract?: OutputContract;
	createdAt: string;
}

export interface AgentSession {
	id: string;
	agentId: string;
	workspaceId: string;
	parentSessionId?: string;
	runtimeSessionIds: Record<string, string>;
	status: "active" | "paused" | "archived";
	createdAt: string;
	lastActiveAt: string;
	metadata?: Record<string, unknown>;
}

export interface AgentRun {
	id: string;
	sessionId: string;
	runtimeId: string;
	attempt: number;
	status: AgentRunStatus;
	preparedRun: PreparedRun;
	startedAt?: string;
	completedAt?: string;
	error?: NormalizedAgentError;
	usage: AgentUsage;
	budgetState: RunBudgetState;
	outputText?: string;
	structuredOutput?: unknown;
	outputValidation?: OutputValidationResult;
	createdAt: string;
	updatedAt: string;
}

export interface AgentUsage {
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	costUsd?: number;
	durationMs?: number;
}

export interface ToolCall {
	id: string;
	toolId: string;
	input: unknown;
	risk?: RiskLevel;
}

export interface ToolResult {
	callId: string;
	output?: unknown;
	error?: string;
	durationMs?: number;
}

export interface ArtifactRecord {
	id: string;
	kind: "file" | "patch" | "report" | "commit" | "link" | "other";
	label: string;
	uri: string;
	metadata?: Record<string, unknown>;
}

export interface PermissionRequest {
	id: string;
	operation: PolicyOperation;
	reason: string;
	requestedAt: string;
}

export interface NormalizedAgentError {
	code: string;
	message: string;
	retryable: boolean;
	detail?: string;
}

interface BaseAgentEvent {
	id: string;
	runId: string;
	sequence: number;
	timestamp: string;
}

export type AgentEvent =
	| (BaseAgentEvent & { type: "run.started"; runtimeId: string })
	| (BaseAgentEvent & { type: "runtime.session"; runtimeId: string; runtimeSessionId: string })
	| (BaseAgentEvent & { type: "assistant.delta"; text: string })
	| (BaseAgentEvent & { type: "runtime.stderr"; text: string })
	| (BaseAgentEvent & { type: "runtime.structured_output"; value: unknown })
	| (BaseAgentEvent & { type: "plan.updated"; steps: PlanStep[] })
	| (BaseAgentEvent & { type: "turn.completed"; turn: number })
	| (BaseAgentEvent & { type: "tool.requested"; call: ToolCall })
	| (BaseAgentEvent & { type: "permission.requested"; request: PermissionRequest })
	| (BaseAgentEvent & { type: "tool.completed"; result: ToolResult })
	| (BaseAgentEvent & { type: "artifact.created"; artifact: ArtifactRecord })
	| (BaseAgentEvent & { type: "usage.updated"; usage: AgentUsage })
	| (BaseAgentEvent & { type: "budget.updated"; state: RunBudgetState })
	| (BaseAgentEvent & { type: "budget.exceeded"; state: RunBudgetState })
	| (BaseAgentEvent & { type: "context.compacted"; records: ContextCompactionRecord[] })
	| (BaseAgentEvent & { type: "output.validated"; result: OutputValidationResult })
	| (BaseAgentEvent & { type: "hook.started"; hookId: string; event: HookEventName })
	| (BaseAgentEvent & { type: "hook.completed"; hookId: string; event: HookEventName; durationMs: number })
	| (BaseAgentEvent & { type: "hook.failed"; hookId: string; event: HookEventName; error: string })
	| (BaseAgentEvent & { type: "mailbox.message"; messageId: string; direction: "queued" | "delivered" })
	| (BaseAgentEvent & { type: "checkpoint.created"; checkpointId: string })
	| (BaseAgentEvent & { type: "checkpoint.restored"; checkpointId: string })
	| (BaseAgentEvent & {
			type: "run.completed";
			outcome: "success" | "partial";
			exitCode?: number;
	  })
	| (BaseAgentEvent & { type: "run.cancelled"; reason?: string })
	| (BaseAgentEvent & { type: "run.failed"; error: NormalizedAgentError });

export interface PlanStep {
	id: string;
	title: string;
	status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface PolicyOperation {
	agentId: string;
	workspaceId: string;
	safetyMode: AgentSafetyMode;
	category:
		| "filesystem.read"
		| "filesystem.write"
		| "filesystem.delete"
		| "command.run"
		| "network.access"
		| "credential.read"
		| "credential.write"
		| "git.push"
		| "package.publish"
		| "external.message"
		| "checkpoint.restore"
		| "other";
	target?: string;
	command?: string;
	reversible?: boolean;
	metadata?: Record<string, unknown>;
}

export interface PolicyDecision {
	result: PolicyResult;
	reason: string;
	ruleId: string;
	riskLevel: RiskLevel;
}

export interface ApprovalRecord {
	id: string;
	runId: string;
	sessionId: string;
	operation: PolicyOperation;
	decision: PolicyDecision;
	status: "pending" | "approved" | "denied" | "expired";
	requestedAt: string;
	resolvedAt?: string;
	resolvedBy?: string;
	note?: string;
}

export interface MemoryRecord {
	id: string;
	scope: "user" | "agent" | "project" | "organization";
	scopeId: string;
	kind: "fact" | "episode" | "procedure";
	text: string;
	status: "proposed" | "active" | "rejected" | "superseded";
	sourceSessionId: string;
	sourceRunId?: string;
	confidence: number;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
	supersedesId?: string;
	approvedBy?: string;
	tags?: string[];
}

export interface MemorySearchResult {
	memory: MemoryRecord;
	score: number;
}

export type AgentTaskStatus =
	| "pending"
	| "ready"
	| "running"
	| "blocked"
	| "completed"
	| "failed"
	| "cancelled";

export interface AgentTask {
	id: string;
	graphId: string;
	key: string;
	title: string;
	description?: string;
	assignedAgentId?: string;
	runtimeId?: string;
	dependencies: string[];
	status: AgentTaskStatus;
	priority: number;
	inputArtifactIds: string[];
	outputArtifactIds: string[];
	maxAttempts: number;
	attempts: number;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

export interface ToolDescriptor {
	id: string;
	version: string;
	description: string;
	requiredScopes: string[];
	operationCategory: PolicyOperation["category"];
	riskLevel: RiskLevel;
	timeoutMs: number;
	maxOutputBytes: number;
	idempotent: boolean;
}

export interface ToolExecutionContext {
	runId: string;
	sessionId: string;
	agentId: string;
	workspaceId: string;
	workspaceRoot: string;
	safetyMode: AgentSafetyMode;
	scopes: string[];
}

export type ToolGatewayResult =
	| {
			status: "completed";
			output: unknown;
			durationMs: number;
			truncated: boolean;
	  }
	| { status: "approval_required"; approval: ApprovalRecord }
	| { status: "denied"; decision: PolicyDecision }
	| { status: "blocked_by_hook"; reason: string };

export interface SkillDefinition {
	id: string;
	name: string;
	version: string;
	description: string;
	instructions: string;
	triggers: string[];
	requiredTools: string[];
	status: "draft" | "active" | "disabled";
	successCount: number;
	failureCount: number;
	createdAt: string;
	updatedAt: string;
}

export type HookEventName =
	| "session.start"
	| "run.before"
	| "run.after"
	| "run.error"
	| "tool.before"
	| "tool.after"
	| "tool.error"
	| "permission.request"
	| "context.beforeCompact"
	| "context.afterCompact"
	| "checkpoint.before"
	| "checkpoint.after"
	| "workspace.changed";

export interface HookInput {
	event: HookEventName;
	runId?: string;
	sessionId?: string;
	agentId?: string;
	runtimeId?: string;
	workspaceId?: string;
	workspaceRoot?: string;
	toolId?: string;
	operation?: PolicyOperation;
	payload?: unknown;
}

export interface HookResult {
	continue?: boolean;
	reason?: string;
	suppressOutput?: boolean;
	additionalContext?: string;
	initialUserMessage?: string;
	updatedInput?: unknown;
	updatedOutput?: unknown;
	permissionDecision?: "allow" | "deny" | "ask";
	retry?: boolean;
	annotations?: Record<string, unknown>;
}

export interface HookDefinition {
	id: string;
	name: string;
	events: HookEventName[];
	priority: number;
	enabled: boolean;
	matcher?: {
		agentId?: string;
		runtimeId?: string;
		toolId?: string;
		workspaceId?: string;
		operationCategory?: PolicyOperation["category"];
	};
	timeoutMs: number;
	kind: "callback" | "command";
	command?: {
		executable: string;
		args?: string[];
		env?: Record<string, string>;
	};
}

export interface HookExecutionResult {
	continue: boolean;
	reason?: string;
	suppressOutput: boolean;
	additionalContexts: string[];
	initialUserMessages: string[];
	updatedInput?: unknown;
	updatedOutput?: unknown;
	permissionDecision?: "allow" | "deny" | "ask";
	retry: boolean;
	annotations: Record<string, unknown>;
	executedHookIds: string[];
}

export interface SessionMessage {
	id: string;
	sessionId: string;
	content: string;
	priority: number;
	status: "queued" | "claimed" | "delivered" | "failed" | "cancelled";
	createdAt: string;
	updatedAt: string;
	claimedAt?: string;
	deliveredAt?: string;
	failedAt?: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface CheckpointFile {
	path: string;
	contentBase64: string;
	mode?: number;
}

export interface CheckpointRecord {
	id: string;
	runId?: string;
	sessionId: string;
	workspaceId: string;
	workspaceRoot: string;
	label: string;
	reason?: string;
	gitHead: string;
	trackedPatch: string;
	untrackedFiles: CheckpointFile[];
	skippedFiles: string[];
	complete: boolean;
	createdAt: string;
	restoredAt?: string;
}


export type SpecialistAgentId =
	| "RESEARCHER"
	| "CODER"
	| "FACT_CHECKER"
	| "SUMMARIZER"
	| "TOOL_EXECUTOR"
	| "CRITIC";

export interface SpecialistAgentProfile {
	id: SpecialistAgentId;
	specialty: string;
	bestFor: string[];
	preferredRuntimeId: string;
	preferredModel: string;
}

export type ChristinaSubtaskStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "blocked";

export interface ChristinaSubtask {
	id: string;
	agentId: SpecialistAgentId;
	title: string;
	prompt: string;
	dependencies: string[];
	status: ChristinaSubtaskStatus;
}

export interface ChristinaRoutePlan {
	id: string;
	createdAt: string;
	maxSpecialistResponses: number;
	requiresFactChecking: boolean;
	subtasks: ChristinaSubtask[];
	routingSummary: string[];
}

export interface ChristinaSource {
	title: string;
	url?: string;
	publishedAt?: string;
	authority: "primary" | "authoritative" | "secondary" | "unknown";
}

export interface ChristinaSpecialistContribution {
	subtaskId: string;
	agentId: SpecialistAgentId;
	runId?: string;
	runtimeId?: string;
	model?: string;
	localModelScore?: number;
	status: "completed" | "failed" | "blocked";
	output: string;
	structuredOutput?: Record<string, unknown>;
	confidence: number;
	sources: ChristinaSource[];
	error?: string;
	completedAt: string;
}

export interface ChristinaConfidence {
	score: number;
	completion: number;
	consensus: number;
	factCheckerVerification: number;
	sourceRecencyAndAuthority: number;
	criticQuality: number;
	needsClarification: boolean;
	reasons: string[];
}

export type ChristinaOrchestrationStatus =
	| "running"
	| "completed"
	| "partial"
	| "failed"
	| "cancelled";

export interface ChristinaOrchestration {
	id: string;
	status: ChristinaOrchestrationStatus;
	originalRequest: string;
	workspaceId: string;
	cwd: string;
	safetyMode: AgentSafetyMode;
	routePlan: ChristinaRoutePlan;
	routingLog: string;
	contributions: ChristinaSpecialistContribution[];
	synthesis?: string;
	finalResponse?: string;
	synthesisRunId?: string;
	confidence?: ChristinaConfidence;
	error?: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface ChristinaOrchestrationInput {
	request: string;
	workspaceId: string;
	cwd: string;
	safetyMode?: AgentSafetyMode;
	explicitAgents?: SpecialistAgentId[];
	runtimeOverrides?: Partial<Record<SpecialistAgentId, string>>;
	modelOverrides?: Partial<Record<SpecialistAgentId, string>>;
	synthesisRuntimeId?: string;
	synthesisModel?: string;
	contextBlocks?: ContextBlock[];
	specialistBudget?: RunBudget;
	synthesisBudget?: RunBudget;
	specialistTimeoutMs?: number;
	synthesisTimeoutMs?: number;
	localModelPolicy?: "local-only" | "prefer-local" | "balanced" | "cloud-first";
	localProviderIds?: string[];
	minimumLocalModelScore?: number;
}

export interface RuntimeDiagnostic {
	runtimeId: string;
	health: RuntimeHealth;
	capabilities: RuntimeCapabilities;
	score: number;
	warnings: string[];
}

export interface DiagnosticReport {
	generatedAt: string;
	platform: NodeJS.Platform;
	nodeVersion: string;
	runtimes: RuntimeDiagnostic[];
	recommendedRuntimeId?: string;
	warnings: string[];
}

export type BookLibrarySourceKind = "file" | "directory";
export type BookDocumentFormat =
	| "pdf"
	| "epub"
	| "text"
	| "markdown"
	| "html"
	| "json"
	| "csv";
export type BookLibraryStatus = "ready" | "scanning" | "unavailable" | "error";
export type BookDocumentStatus = "indexed" | "skipped" | "error";
export type LibraryAccessLevel = "read" | "teach";

export interface BookLibraryRecord {
	id: string;
	name: string;
	sourcePath: string;
	sourceKind: BookLibrarySourceKind;
	status: BookLibraryStatus;
	includeExtensions: string[];
	recursive: boolean;
	followSymlinks: boolean;
	maxFileSizeBytes: number;
	createdAt: string;
	updatedAt: string;
	lastScannedAt?: string;
	lastAvailableAt?: string;
	documentCount: number;
	chunkCount: number;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface BookDocumentRecord {
	id: string;
	libraryId: string;
	absolutePath: string;
	relativePath: string;
	title: string;
	author?: string;
	format: BookDocumentFormat;
	status: BookDocumentStatus;
	sizeBytes: number;
	modifiedAt: string;
	checksum: string;
	chapterCount?: number;
	chunkCount: number;
	indexedAt: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface BookChunkRecord {
	id: string;
	libraryId: string;
	documentId: string;
	ordinal: number;
	text: string;
	title: string;
	author?: string;
	section?: string;
	page?: number;
	tokenEstimate: number;
	searchTerms: string[];
	createdAt: string;
}

export interface LibraryAgentAssignment {
	id: string;
	libraryId: string;
	agentId: string;
	access: LibraryAccessLevel;
	createdAt: string;
	createdBy: string;
	note?: string;
}

export interface KnowledgeAgentProfile {
	id: string;
	name: string;
	runtimeId: string;
	model: string;
	localOnly: boolean;
	libraryIds: string[];
	teachingStyle: "socratic" | "direct" | "step-by-step" | "exam-prep";
	status: "active" | "disabled";
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

export interface BookLibraryScanResult {
	library: BookLibraryRecord;
	indexed: number;
	skipped: number;
	failed: number;
	removed: number;
	warnings: string[];
}

export interface BookSearchResult {
	chunk: BookChunkRecord;
	document: BookDocumentRecord;
	library: BookLibraryRecord;
	score: number;
	citation: string;
}

export interface AskKnowledgeAgentRequest {
	agentProfileId: string;
	question: string;
	workspaceId?: string;
	cwd?: string;
	mode?: "answer" | "teach" | "quiz" | "study-guide";
	maxChunks?: number;
	maxContextTokens?: number;
	safetyMode?: AgentSafetyMode;
	budget?: RunBudget;
}

export interface AskKnowledgeAgentResult {
	run: AgentRun;
	profile: KnowledgeAgentProfile;
	results: BookSearchResult[];
	citations: string[];
}

export type ScheduleStatus = "active" | "paused" | "completed";

export type ScheduleTrigger =
	| { type: "once"; runAt: string }
	| { type: "interval"; everyMinutes: number };

export interface ScheduledRunRecord {
	id: string;
	agentId: string;
	runtimeId: string;
	workspaceId: string;
	cwd: string;
	prompt: string;
	safetyMode: AgentSafetyMode;
	model?: string;
	trigger: ScheduleTrigger;
	status: ScheduleStatus;
	nextRunAt?: string;
	lastRunAt?: string;
	lastRunId?: string;
	lastError?: string;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

export interface ScheduledRunDispatchResult {
	schedule: ScheduledRunRecord;
	runId?: string;
	status: "dispatched" | "skipped" | "failed";
	reason?: string;
}
