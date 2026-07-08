import { randomUUID } from "node:crypto";
import type { AgentEvent } from "./types";

type EventPayload = AgentEvent extends infer Event
	? Event extends AgentEvent
		? Omit<Event, "id" | "runId" | "sequence" | "timestamp">
		: never
	: never;

export class EventFactory {
	private sequence = 0;

	constructor(private readonly runId: string) {}

	create<T extends EventPayload>(event: T): AgentEvent {
		this.sequence += 1;
		return {
			...event,
			id: randomUUID(),
			runId: this.runId,
			sequence: this.sequence,
			timestamp: new Date().toISOString(),
		} as AgentEvent;
	}

	resequence(event: AgentEvent): AgentEvent {
		const {
			id: _id,
			runId: _runId,
			sequence: _sequence,
			timestamp: _timestamp,
			...payload
		} = event;
		return this.create(payload as EventPayload);
	}
}
