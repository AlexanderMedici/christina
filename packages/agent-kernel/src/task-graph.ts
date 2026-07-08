import { randomUUID } from "node:crypto";
import type { AgentKernelStore } from "./store";
import type { AgentTask, AgentTaskStatus } from "./types";

export interface TaskGraphInput {
	graphId?: string;
	tasks: Array<{
		key: string;
		title: string;
		description?: string;
		dependencies?: string[];
		assignedAgentId?: string;
		runtimeId?: string;
		priority?: number;
		maxAttempts?: number;
		metadata?: Record<string, unknown>;
	}>;
}

function assertAcyclic(tasks: AgentTask[]): void {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string) => {
		if (visiting.has(id))
			throw new Error("Task graph contains a dependency cycle.");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of byId.get(id)?.dependencies ?? [])
			visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const task of tasks) visit(task.id);
}

export class TaskGraphService {
	constructor(private readonly store: AgentKernelStore) {}

	async create(input: TaskGraphInput): Promise<AgentTask[]> {
		const graphId = input.graphId ?? randomUUID();
		const ids = new Map<string, string>();
		for (const task of input.tasks) {
			if (ids.has(task.key)) throw new Error(`Duplicate task key: ${task.key}`);
			ids.set(task.key, randomUUID());
		}
		const now = new Date().toISOString();
		const tasks = input.tasks.map<AgentTask>((task) => {
			const dependencies = (task.dependencies ?? []).map((key) => {
				const id = ids.get(key);
				if (!id) throw new Error(`Unknown task dependency: ${key}`);
				return id;
			});
			return {
				id: ids.get(task.key) as string,
				graphId,
				key: task.key,
				title: task.title,
				description: task.description,
				assignedAgentId: task.assignedAgentId,
				runtimeId: task.runtimeId,
				dependencies,
				status: dependencies.length === 0 ? "ready" : "pending",
				priority: task.priority ?? 0,
				inputArtifactIds: [],
				outputArtifactIds: [],
				maxAttempts: task.maxAttempts ?? 1,
				attempts: 0,
				createdAt: now,
				updatedAt: now,
				metadata: task.metadata,
			};
		});
		assertAcyclic(tasks);
		await Promise.all(tasks.map((task) => this.store.putTask(task)));
		return tasks;
	}

	async refresh(graphId: string): Promise<AgentTask[]> {
		const tasks = await this.store.listTasks(graphId);
		const byId = new Map(tasks.map((task) => [task.id, task]));
		const now = new Date().toISOString();
		const updates: AgentTask[] = [];
		for (const task of tasks) {
			if (task.status !== "pending" && task.status !== "blocked") continue;
			const dependencies = task.dependencies.map((id) => byId.get(id));
			const failed = dependencies.some(
				(dependency) =>
					dependency?.status === "failed" || dependency?.status === "cancelled",
			);
			const completed = dependencies.every(
				(dependency) => dependency?.status === "completed",
			);
			const status: AgentTaskStatus = failed
				? "blocked"
				: completed
					? "ready"
					: "pending";
			if (status !== task.status)
				updates.push({ ...task, status, updatedAt: now });
		}
		await Promise.all(updates.map((task) => this.store.putTask(task)));
		return this.store.listTasks(graphId);
	}

	async ready(graphId: string): Promise<AgentTask[]> {
		return (await this.refresh(graphId)).filter(
			(task) => task.status === "ready",
		);
	}

	async update(
		id: string,
		status: AgentTaskStatus,
		patch: Partial<
			Pick<AgentTask, "assignedAgentId" | "runtimeId" | "outputArtifactIds">
		> = {},
	): Promise<AgentTask> {
		const task = await this.store.getTask(id);
		if (!task) throw new Error(`Task not found: ${id}`);
		const attempts =
			status === "running" && task.status !== "running"
				? task.attempts + 1
				: task.attempts;
		if (attempts > task.maxAttempts)
			throw new Error(`Task exceeded max attempts: ${id}`);
		const updated: AgentTask = {
			...task,
			...patch,
			status,
			attempts,
			updatedAt: new Date().toISOString(),
		};
		await this.store.putTask(updated);
		await this.refresh(task.graphId);
		return updated;
	}
}
