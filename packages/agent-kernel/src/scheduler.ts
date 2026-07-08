import { randomUUID } from "node:crypto";
import type { AgentKernelStore } from "./store";
import type {
	ScheduledRunDispatchResult,
	ScheduledRunRecord,
	ScheduleStatus,
	ScheduleTrigger,
} from "./types";

const FIVE_MINUTES_MS = 5 * 60_000;

function nextRunFromTrigger(trigger: ScheduleTrigger, now: Date): string | undefined {
	if (trigger.type === "once") return undefined;
	return new Date(now.getTime() + trigger.everyMinutes * 60_000).toISOString();
}

function initialNextRunAt(trigger: ScheduleTrigger, now: Date): string {
	if (trigger.type === "once") return trigger.runAt;
	return now.toISOString();
}

export class SchedulerService {
	constructor(private readonly store: AgentKernelStore) {}

	async create(input: {
		agentId: string;
		runtimeId: string;
		workspaceId: string;
		cwd: string;
		prompt: string;
		safetyMode?: ScheduledRunRecord["safetyMode"];
		model?: string;
		trigger: ScheduleTrigger;
		metadata?: Record<string, unknown>;
	}): Promise<ScheduledRunRecord> {
		const now = new Date();
		const schedule: ScheduledRunRecord = {
			id: randomUUID(),
			agentId: input.agentId,
			runtimeId: input.runtimeId,
			workspaceId: input.workspaceId,
			cwd: input.cwd,
			prompt: input.prompt,
			safetyMode: input.safetyMode ?? "workspace",
			model: input.model,
			trigger: input.trigger,
			status: "active",
			nextRunAt: initialNextRunAt(input.trigger, now),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			metadata: input.metadata,
		};
		await this.store.putSchedule(schedule);
		return schedule;
	}

	async list(status?: ScheduleStatus): Promise<ScheduledRunRecord[]> {
		const schedules = await this.store.listSchedules();
		return status ? schedules.filter((schedule) => schedule.status === status) : schedules;
	}

	async pause(id: string): Promise<ScheduledRunRecord> {
		return this.updateStatus(id, "paused");
	}

	async resume(id: string): Promise<ScheduledRunRecord> {
		const existing = await this.require(id);
		const now = new Date();
		const resumed: ScheduledRunRecord = {
			...existing,
			status: "active",
			nextRunAt: existing.nextRunAt ?? initialNextRunAt(existing.trigger, now),
			updatedAt: now.toISOString(),
		};
		await this.store.putSchedule(resumed);
		return resumed;
	}

	async complete(id: string): Promise<ScheduledRunRecord> {
		return this.updateStatus(id, "completed");
	}

	async delete(id: string): Promise<void> {
		await this.store.deleteSchedule(id);
	}

	async due(at = new Date()): Promise<ScheduledRunRecord[]> {
		const schedules = await this.list("active");
		return schedules.filter((schedule) => schedule.nextRunAt && schedule.nextRunAt <= at.toISOString());
	}

	async dispatchDue(
		dispatcher: (schedule: ScheduledRunRecord) => Promise<{ runId: string }>,
		at = new Date(),
	): Promise<ScheduledRunDispatchResult[]> {
		const dueSchedules = await this.due(at);
		const results: ScheduledRunDispatchResult[] = [];
		for (const schedule of dueSchedules) {
			try {
				const dispatched = await dispatcher(schedule);
				const now = new Date();
				const updated: ScheduledRunRecord = {
					...schedule,
					lastRunAt: now.toISOString(),
					lastRunId: dispatched.runId,
					lastError: undefined,
					nextRunAt: nextRunFromTrigger(schedule.trigger, now),
					status: schedule.trigger.type === "once" ? "completed" : "active",
					updatedAt: now.toISOString(),
				};
				await this.store.putSchedule(updated);
				results.push({ schedule: updated, runId: dispatched.runId, status: "dispatched" });
			} catch (error) {
				const retryAt = new Date(at.getTime() + FIVE_MINUTES_MS).toISOString();
				const failed: ScheduledRunRecord = {
					...schedule,
					lastError: error instanceof Error ? error.message : String(error),
					nextRunAt: retryAt,
					updatedAt: new Date().toISOString(),
				};
				await this.store.putSchedule(failed);
				results.push({
					schedule: failed,
					status: "failed",
					reason: failed.lastError,
				});
			}
		}
		return results;
	}

	private async updateStatus(id: string, status: ScheduleStatus): Promise<ScheduledRunRecord> {
		const existing = await this.require(id);
		const updated: ScheduledRunRecord = {
			...existing,
			status,
			nextRunAt: status === "paused" ? existing.nextRunAt : existing.nextRunAt,
			updatedAt: new Date().toISOString(),
		};
		await this.store.putSchedule(updated);
		return updated;
	}

	private async require(id: string): Promise<ScheduledRunRecord> {
		const schedule = await this.store.getSchedule(id);
		if (!schedule) throw new Error(`Schedule not found: ${id}`);
		return schedule;
	}
}
