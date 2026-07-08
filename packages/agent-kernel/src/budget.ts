import type {
	AgentEvent,
	AgentUsage,
	RunBudget,
	RunBudgetState,
} from "./types";

export function createBudgetState(startedAt?: string): RunBudgetState {
	return {
		startedAt,
		durationMs: 0,
		turns: 0,
		costUsd: 0,
		inputTokens: 0,
		outputTokens: 0,
		cachedTokens: 0,
		toolCalls: 0,
		assistantChars: 0,
	};
}

function mergeUsage(state: RunBudgetState, usage: AgentUsage): RunBudgetState {
	return {
		...state,
		durationMs: usage.durationMs ?? state.durationMs,
		costUsd: usage.costUsd ?? state.costUsd,
		inputTokens: usage.inputTokens ?? state.inputTokens,
		outputTokens: usage.outputTokens ?? state.outputTokens,
		cachedTokens: usage.cachedTokens ?? state.cachedTokens,
	};
}

export function updateBudgetState(
	state: RunBudgetState,
	event: AgentEvent,
): RunBudgetState {
	if (event.type === "usage.updated") return mergeUsage(state, event.usage);
	if (event.type === "tool.requested") {
		return { ...state, toolCalls: state.toolCalls + 1 };
	}
	if (event.type === "turn.completed") {
		return { ...state, turns: Math.max(state.turns, event.turn) };
	}
	if (event.type === "assistant.delta") {
		return {
			...state,
			assistantChars: state.assistantChars + event.text.length,
		};
	}
	return state;
}

export function updateDuration(
	state: RunBudgetState,
	now = Date.now(),
): RunBudgetState {
	if (!state.startedAt) return state;
	return {
		...state,
		durationMs: Math.max(0, now - Date.parse(state.startedAt)),
	};
}

export function findExceededBudget(
	budget: RunBudget | undefined,
	state: RunBudgetState,
): RunBudgetState["exceeded"] | undefined {
	if (!budget) return undefined;
	const checks: Array<{
		limit: keyof RunBudget;
		actual: number;
		allowed: number | undefined;
	}> = [
		{ limit: "maxDurationMs", actual: state.durationMs, allowed: budget.maxDurationMs },
		{ limit: "maxTurns", actual: state.turns, allowed: budget.maxTurns },
		{ limit: "maxCostUsd", actual: state.costUsd, allowed: budget.maxCostUsd },
		{ limit: "maxInputTokens", actual: state.inputTokens, allowed: budget.maxInputTokens },
		{ limit: "maxOutputTokens", actual: state.outputTokens, allowed: budget.maxOutputTokens },
		{
			limit: "maxTotalTokens",
			actual: state.inputTokens + state.outputTokens,
			allowed: budget.maxTotalTokens,
		},
		{ limit: "maxToolCalls", actual: state.toolCalls, allowed: budget.maxToolCalls },
		{
			limit: "maxAssistantChars",
			actual: state.assistantChars,
			allowed: budget.maxAssistantChars,
		},
	];
	const exceeded = checks.find(
		(check) => check.allowed !== undefined && check.actual > check.allowed,
	);
	if (!exceeded || exceeded.allowed === undefined) return undefined;
	return {
		limit: exceeded.limit,
		actual: exceeded.actual,
		allowed: exceeded.allowed,
		at: new Date().toISOString(),
	};
}
