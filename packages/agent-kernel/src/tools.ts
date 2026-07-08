import type { HookEngine } from "./hooks";
import type { PolicyEngine } from "./policy";
import type {
	ApprovalRecord,
	PolicyDecision,
	PolicyOperation,
	ToolDescriptor,
	ToolExecutionContext,
	ToolGatewayResult,
} from "./types";

export interface ToolDefinition<TInput = unknown, TOutput = unknown>
	extends ToolDescriptor {
	validate?: (input: unknown) => TInput;
	execute: (
		input: TInput,
		context: ToolExecutionContext,
		signal: AbortSignal,
	) => Promise<TOutput>;
	operation?: (
		input: TInput,
		context: ToolExecutionContext,
	) => Partial<PolicyOperation>;
}

export interface ToolGatewayOptions {
	policy: PolicyEngine;
	hooks?: HookEngine;
	requestApproval: (input: {
		runId: string;
		operation: PolicyOperation;
		workspaceRoot: string;
	}) => Promise<ApprovalRecord>;
}

function byteLength(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function truncateOutput(value: unknown, maxBytes: number): unknown {
	if (typeof value === "string") {
		return `${value.slice(0, Math.max(0, maxBytes - 64))}\n[output truncated by CHRISTINA]`;
	}
	return {
		truncated: true,
		summary: "Tool output exceeded the configured byte limit.",
	};
}

function hookDecision(
	decision: PolicyDecision,
	hook: "allow" | "deny" | "ask" | undefined,
): PolicyDecision {
	if (!hook) return decision;
	if (hook === "deny") {
		return {
			result: "deny",
			reason: "A trusted host hook denied this tool operation.",
			ruleId: "hook.permission-deny",
			riskLevel: decision.riskLevel,
		};
	}
	if (hook === "ask" && decision.result !== "deny") {
		return {
			result: "require_approval",
			reason: "A trusted host hook requested approval.",
			ruleId: "hook.permission-ask",
			riskLevel: decision.riskLevel,
		};
	}
	if (hook === "allow" && decision.result === "require_approval") {
		return {
			result: "allow",
			reason: "A trusted host hook approved this operation.",
			ruleId: "hook.permission-allow",
			riskLevel: decision.riskLevel,
		};
	}
	return decision;
}

export class ToolGateway {
	private readonly tools = new Map<string, ToolDefinition>();

	constructor(private readonly options: ToolGatewayOptions) {}

	register(definition: ToolDefinition): void {
		if (this.tools.has(definition.id)) {
			throw new Error(`Tool already registered: ${definition.id}`);
		}
		this.tools.set(definition.id, definition);
	}

	list(scopes: string[]): ToolDescriptor[] {
		const granted = new Set(scopes);
		return [...this.tools.values()]
			.filter((tool) =>
				tool.requiredScopes.every((scope) => granted.has(scope)),
			)
			.map(
				({
					execute: _execute,
					validate: _validate,
					operation: _operation,
					...descriptor
				}) => descriptor,
			);
	}

	async execute(input: {
		toolId: string;
		toolInput: unknown;
		context: ToolExecutionContext;
	}): Promise<ToolGatewayResult> {
		const tool = this.tools.get(input.toolId);
		if (!tool) throw new Error(`Unknown tool: ${input.toolId}`);
		const granted = new Set(input.context.scopes);
		if (!tool.requiredScopes.every((scope) => granted.has(scope))) {
			return {
				status: "denied",
				decision: {
					result: "deny",
					reason: "The agent does not have every scope required by this tool.",
					ruleId: "tool.scope",
					riskLevel: "high",
				},
			};
		}

		let validated = tool.validate
			? tool.validate(input.toolInput)
			: input.toolInput;
		let operation: PolicyOperation = {
			agentId: input.context.agentId,
			workspaceId: input.context.workspaceId,
			safetyMode: input.context.safetyMode,
			category: tool.operationCategory,
			reversible: tool.idempotent,
			...(tool.operation?.(validated, input.context) ?? {}),
		};
		const before = await this.options.hooks?.execute({
			event: "tool.before",
			runId: input.context.runId,
			sessionId: input.context.sessionId,
			agentId: input.context.agentId,
			workspaceId: input.context.workspaceId,
			workspaceRoot: input.context.workspaceRoot,
			toolId: tool.id,
			operation,
			payload: validated,
		});
		if (before && !before.continue) {
			return {
				status: "blocked_by_hook",
				reason: before.reason ?? "Tool execution was blocked by a hook.",
			};
		}
		if (before?.updatedInput !== undefined) {
			validated = tool.validate
				? tool.validate(before.updatedInput)
				: before.updatedInput;
			operation = {
				...operation,
				...(tool.operation?.(validated, input.context) ?? {}),
			};
		}

		let decision = this.options.policy.evaluate(
			operation,
			input.context.workspaceRoot,
		);
		decision = hookDecision(decision, before?.permissionDecision);
		const permissionHook = await this.options.hooks?.execute({
			event: "permission.request",
			runId: input.context.runId,
			sessionId: input.context.sessionId,
			agentId: input.context.agentId,
			workspaceId: input.context.workspaceId,
			workspaceRoot: input.context.workspaceRoot,
			toolId: tool.id,
			operation,
			payload: { decision },
		});
		decision = hookDecision(decision, permissionHook?.permissionDecision);
		if (decision.result === "deny") return { status: "denied", decision };
		if (decision.result === "require_approval") {
			const approval = await this.options.requestApproval({
				runId: input.context.runId,
				operation,
				workspaceRoot: input.context.workspaceRoot,
			});
			return { status: "approval_required", approval };
		}

		const controller = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => {
				controller.abort();
				reject(
					new Error(`Tool timed out after ${tool.timeoutMs}ms: ${tool.id}`),
				);
			}, tool.timeoutMs);
		});
		const started = Date.now();
		try {
			let output: unknown = await Promise.race([
				tool.execute(validated, input.context, controller.signal),
				timeoutPromise,
			]);
			const after = await this.options.hooks?.execute({
				event: "tool.after",
				runId: input.context.runId,
				sessionId: input.context.sessionId,
				agentId: input.context.agentId,
				workspaceId: input.context.workspaceId,
				workspaceRoot: input.context.workspaceRoot,
				toolId: tool.id,
				operation,
				payload: { input: validated, output },
			});
			if (after?.updatedOutput !== undefined) output = after.updatedOutput;
			const truncated = byteLength(output) > tool.maxOutputBytes;
			return {
				status: "completed",
				output: truncated
					? truncateOutput(output, tool.maxOutputBytes)
					: output,
				durationMs: Date.now() - started,
				truncated,
			};
		} catch (error) {
			await this.options.hooks?.execute({
				event: "tool.error",
				runId: input.context.runId,
				sessionId: input.context.sessionId,
				agentId: input.context.agentId,
				workspaceId: input.context.workspaceId,
				workspaceRoot: input.context.workspaceRoot,
				toolId: tool.id,
				operation,
				payload: {
					input: validated,
					error: error instanceof Error ? error.message : String(error),
				},
			});
			throw error;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}
}
