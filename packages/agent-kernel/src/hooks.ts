import { runProcess } from "./process";
import type {
	HookDefinition,
	HookEventName,
	HookExecutionResult,
	HookInput,
	HookResult,
} from "./types";

export type HookCallback = (
	input: HookInput,
	signal: AbortSignal,
) => Promise<HookResult>;

interface RegisteredHook {
	definition: HookDefinition;
	callback?: HookCallback;
}

export interface HookEventReporter {
	started?(hookId: string, event: HookEventName): void | Promise<void>;
	completed?(
		hookId: string,
		event: HookEventName,
		durationMs: number,
	): void | Promise<void>;
	failed?(
		hookId: string,
		event: HookEventName,
		error: string,
	): void | Promise<void>;
}

function wildcardMatch(value: string | undefined, pattern: string | undefined): boolean {
	if (!pattern) return true;
	if (value === undefined) return false;
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i").test(value);
}

function matches(definition: HookDefinition, input: HookInput): boolean {
	if (!definition.enabled || !definition.events.includes(input.event)) return false;
	const matcher = definition.matcher;
	if (!matcher) return true;
	return (
		wildcardMatch(input.agentId, matcher.agentId) &&
		wildcardMatch(input.runtimeId, matcher.runtimeId) &&
		wildcardMatch(input.toolId, matcher.toolId) &&
		wildcardMatch(input.workspaceId, matcher.workspaceId) &&
		wildcardMatch(input.operation?.category, matcher.operationCategory)
	);
}

function mergeResult(
	aggregate: HookExecutionResult,
	result: HookResult,
): HookExecutionResult {
	return {
		continue: aggregate.continue && result.continue !== false,
		reason: result.reason ?? aggregate.reason,
		suppressOutput: aggregate.suppressOutput || result.suppressOutput === true,
		additionalContexts: result.additionalContext
			? [...aggregate.additionalContexts, result.additionalContext]
			: aggregate.additionalContexts,
		initialUserMessages: result.initialUserMessage
			? [...aggregate.initialUserMessages, result.initialUserMessage]
			: aggregate.initialUserMessages,
		updatedInput: result.updatedInput ?? aggregate.updatedInput,
		updatedOutput: result.updatedOutput ?? aggregate.updatedOutput,
		permissionDecision:
			result.permissionDecision ?? aggregate.permissionDecision,
		retry: aggregate.retry || result.retry === true,
		annotations: {
			...aggregate.annotations,
			...(result.annotations ?? {}),
		},
		executedHookIds: aggregate.executedHookIds,
	};
}

function parseCommandHookOutput(stdout: string): HookResult {
	const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (lines.length === 0) return {};
	const candidate = lines.at(-1) ?? "{}";
	const parsed = JSON.parse(candidate) as HookResult;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Hook output must be a JSON object.");
	}
	return parsed;
}

export class HookEngine {
	private readonly hooks = new Map<string, RegisteredHook>();

	register(definition: HookDefinition, callback?: HookCallback): void {
		if (this.hooks.has(definition.id)) {
			throw new Error(`Hook already registered: ${definition.id}`);
		}
		if (definition.kind === "callback" && !callback) {
			throw new Error(`Callback hook requires a callback: ${definition.id}`);
		}
		if (definition.kind === "command" && !definition.command) {
			throw new Error(`Command hook requires command configuration: ${definition.id}`);
		}
		this.hooks.set(definition.id, { definition, callback });
	}

	unregister(id: string): boolean {
		return this.hooks.delete(id);
	}

	list(event?: HookEventName): HookDefinition[] {
		return [...this.hooks.values()]
			.map((entry) => entry.definition)
			.filter((definition) => !event || definition.events.includes(event))
			.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
	}

	async execute(
		input: HookInput,
		options: { signal?: AbortSignal; reporter?: HookEventReporter } = {},
	): Promise<HookExecutionResult> {
		let aggregate: HookExecutionResult = {
			continue: true,
			suppressOutput: false,
			additionalContexts: [],
			initialUserMessages: [],
			retry: false,
			annotations: {},
			executedHookIds: [],
		};
		let currentInput = input;
		const hooks = [...this.hooks.values()]
			.filter(({ definition }) => matches(definition, input))
			.sort(
				(a, b) =>
					b.definition.priority - a.definition.priority ||
					a.definition.id.localeCompare(b.definition.id),
			);

		for (const hook of hooks) {
			if (!aggregate.continue || options.signal?.aborted) break;
			const started = Date.now();
			await options.reporter?.started?.(hook.definition.id, input.event);
			const controller = new AbortController();
			const abort = () => controller.abort();
			options.signal?.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(() => controller.abort(), hook.definition.timeoutMs);
			try {
				let result: HookResult;
				if (hook.definition.kind === "callback") {
					result = await hook.callback?.(currentInput, controller.signal) ?? {};
				} else {
					const command = hook.definition.command;
					if (!command) throw new Error("Missing command hook configuration.");
					const processResult = await runProcess({
						binary: command.executable,
						args: command.args,
						cwd: input.workspaceRoot,
						env: command.env,
						stdin: `${JSON.stringify(currentInput)}\n`,
						timeoutMs: hook.definition.timeoutMs,
						signal: controller.signal,
					});
					if (processResult.timedOut) {
						throw new Error(`Hook timed out after ${hook.definition.timeoutMs}ms.`);
					}
					if (processResult.exitCode !== 0) {
						throw new Error(
							processResult.stderr.trim() ||
								`Hook exited with ${processResult.exitCode ?? "unknown"}.`,
						);
					}
					result = parseCommandHookOutput(processResult.stdout);
				}
				aggregate = mergeResult(aggregate, result);
				aggregate.executedHookIds.push(hook.definition.id);
				if (result.updatedInput !== undefined) {
					currentInput = { ...currentInput, payload: result.updatedInput };
				}
				await options.reporter?.completed?.(
					hook.definition.id,
					input.event,
					Date.now() - started,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await options.reporter?.failed?.(hook.definition.id, input.event, message);
				aggregate.annotations[`hook_error:${hook.definition.id}`] = message;
			} finally {
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", abort);
			}
		}
		return aggregate;
	}
}
