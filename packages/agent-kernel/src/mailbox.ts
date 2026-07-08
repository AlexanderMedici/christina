import { randomUUID } from "node:crypto";
import type { AgentKernelStore } from "./store";
import type { ContextBlock, SessionMessage } from "./types";

export class SessionMailboxService {
	constructor(private readonly store: AgentKernelStore) {}

	async queue(input: {
		sessionId: string;
		content: string;
		priority?: number;
		metadata?: Record<string, unknown>;
	}): Promise<SessionMessage> {
		const now = new Date().toISOString();
		const message: SessionMessage = {
			id: randomUUID(),
			sessionId: input.sessionId,
			content: input.content,
			priority: input.priority ?? 0,
			status: "queued",
			createdAt: now,
			updatedAt: now,
			metadata: input.metadata,
		};
		await this.store.putMessage(message);
		return message;
	}

	async list(sessionId: string): Promise<SessionMessage[]> {
		return this.store.listMessages(sessionId);
	}

	async claimBatch(sessionId: string, limit = 10): Promise<SessionMessage[]> {
		const messages = (await this.store.listMessages(sessionId))
			.filter((message) => message.status === "queued")
			.slice(0, Math.max(0, limit));
		const now = new Date().toISOString();
		const claimed = messages.map((message) => ({
			...message,
			status: "claimed" as const,
			claimedAt: now,
			updatedAt: now,
		}));
		await Promise.all(claimed.map((message) => this.store.putMessage(message)));
		return claimed;
	}

	async markDelivered(ids: string[]): Promise<void> {
		const now = new Date().toISOString();
		await Promise.all(
			ids.map(async (id) => {
				const message = await this.store.getMessage(id);
				if (!message) return;
				await this.store.putMessage({
					...message,
					status: "delivered",
					deliveredAt: now,
					updatedAt: now,
				});
			}),
		);
	}

	async release(ids: string[], error?: string): Promise<void> {
		const now = new Date().toISOString();
		await Promise.all(
			ids.map(async (id) => {
				const message = await this.store.getMessage(id);
				if (!message || message.status !== "claimed") return;
				await this.store.putMessage({
					...message,
					status: error ? "failed" : "queued",
					failedAt: error ? now : undefined,
					error,
					updatedAt: now,
				});
			}),
		);
	}

	async cancel(id: string): Promise<SessionMessage> {
		const message = await this.store.getMessage(id);
		if (!message) throw new Error(`Mailbox message not found: ${id}`);
		const updated: SessionMessage = {
			...message,
			status: "cancelled",
			updatedAt: new Date().toISOString(),
		};
		await this.store.putMessage(updated);
		return updated;
	}

	toContextBlock(messages: SessionMessage[]): ContextBlock | undefined {
		if (messages.length === 0) return undefined;
		return {
			id: `mailbox-${messages.map((message) => message.id).join("-")}`,
			kind: "mailbox",
			priority: 92,
			pinned: true,
			content: messages
				.map((message, index) => `${index + 1}. ${message.content}`)
				.join("\n"),
			source: "session-mailbox",
		};
	}
}
