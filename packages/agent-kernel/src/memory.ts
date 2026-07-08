import { randomUUID } from "node:crypto";
import type { AgentKernelStore } from "./store";
import type { MemoryRecord, MemorySearchResult } from "./types";

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9_+-]+/)
			.filter((token) => token.length > 1),
	);
}

function similarity(query: Set<string>, text: Set<string>): number {
	if (query.size === 0 || text.size === 0) return 0;
	let overlap = 0;
	for (const token of query) if (text.has(token)) overlap += 1;
	return overlap / Math.sqrt(query.size * text.size);
}

export class MemoryService {
	constructor(private readonly store: AgentKernelStore) {}

	async propose(
		input: Omit<MemoryRecord, "id" | "status" | "createdAt" | "updatedAt">,
	): Promise<MemoryRecord> {
		const now = new Date().toISOString();
		const memory: MemoryRecord = {
			...input,
			id: randomUUID(),
			status: "proposed",
			createdAt: now,
			updatedAt: now,
		};
		await this.store.putMemory(memory);
		return memory;
	}

	async setStatus(
		id: string,
		status: "active" | "rejected" | "superseded",
		approvedBy?: string,
	): Promise<MemoryRecord> {
		const existing = await this.store.getMemory(id);
		if (!existing) throw new Error(`Memory not found: ${id}`);
		const updated: MemoryRecord = {
			...existing,
			status,
			approvedBy: status === "active" ? approvedBy : existing.approvedBy,
			updatedAt: new Date().toISOString(),
		};
		await this.store.putMemory(updated);
		return updated;
	}

	async search(
		query: string,
		scopeId?: string,
		limit = 8,
	): Promise<MemorySearchResult[]> {
		const queryTokens = tokenize(query);
		const now = Date.now();
		const memories = await this.store.listMemories();
		return memories
			.filter((memory) => memory.status === "active")
			.filter((memory) => !scopeId || memory.scopeId === scopeId)
			.filter(
				(memory) => !memory.expiresAt || Date.parse(memory.expiresAt) > now,
			)
			.map((memory) => {
				const lexical = similarity(
					queryTokens,
					tokenize(`${memory.text} ${(memory.tags ?? []).join(" ")}`),
				);
				const confidence = Math.max(0, Math.min(1, memory.confidence));
				return { memory, score: lexical * 0.8 + confidence * 0.2 };
			})
			.filter((result) => result.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}
}
