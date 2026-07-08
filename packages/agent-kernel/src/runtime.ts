import type {
	AgentEvent,
	PreparedRun,
	RuntimeCapabilities,
	RuntimeHealth,
} from "./types";

export interface AgentRuntimeAdapter {
	readonly id: string;
	readonly capabilities: RuntimeCapabilities;
	supports(run: PreparedRun): boolean;
	start(run: PreparedRun): AsyncIterable<AgentEvent>;
	resume?(
		runtimeSessionId: string,
		run: PreparedRun,
	): AsyncIterable<AgentEvent>;
	cancel(runId: string): Promise<void>;
	healthCheck(): Promise<RuntimeHealth>;
}

export class RuntimeRegistry {
	private readonly adapters = new Map<string, AgentRuntimeAdapter>();

	register(adapter: AgentRuntimeAdapter): void {
		if (this.adapters.has(adapter.id)) {
			throw new Error(`Runtime already registered: ${adapter.id}`);
		}
		this.adapters.set(adapter.id, adapter);
	}

	get(id: string): AgentRuntimeAdapter {
		const adapter = this.adapters.get(id);
		if (!adapter) throw new Error(`Unknown agent runtime: ${id}`);
		return adapter;
	}

	has(id: string): boolean {
		return this.adapters.has(id);
	}

	list(): AgentRuntimeAdapter[] {
		return [...this.adapters.values()];
	}
}
