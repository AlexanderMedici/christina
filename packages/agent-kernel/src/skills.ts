import { randomUUID } from "node:crypto";
import type { AgentKernelStore } from "./store";
import type { SkillDefinition } from "./types";

function terms(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9_+-]+/)
			.filter((term) => term.length > 1),
	);
}

export class SkillService {
	constructor(private readonly store: AgentKernelStore) {}

	async create(
		input: Omit<
			SkillDefinition,
			| "id"
			| "status"
			| "successCount"
			| "failureCount"
			| "createdAt"
			| "updatedAt"
		> & { status?: SkillDefinition["status"] },
	): Promise<SkillDefinition> {
		const now = new Date().toISOString();
		const skill: SkillDefinition = {
			...input,
			id: randomUUID(),
			status: input.status ?? "draft",
			successCount: 0,
			failureCount: 0,
			createdAt: now,
			updatedAt: now,
		};
		await this.store.putSkill(skill);
		return skill;
	}

	async select(query: string, limit = 5): Promise<SkillDefinition[]> {
		const queryTerms = terms(query);
		return (await this.store.listSkills())
			.filter((skill) => skill.status === "active")
			.map((skill) => {
				const haystack = terms(
					`${skill.name} ${skill.description} ${skill.triggers.join(" ")}`,
				);
				let overlap = 0;
				for (const term of queryTerms) if (haystack.has(term)) overlap += 1;
				const reliability =
					(skill.successCount + 1) /
					(skill.successCount + skill.failureCount + 2);
				return { skill, score: overlap + reliability * 0.25 };
			})
			.filter((entry) => entry.score > 0.25)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((entry) => entry.skill);
	}

	async setStatus(
		id: string,
		status: SkillDefinition["status"],
	): Promise<SkillDefinition> {
		const skill = (await this.store.listSkills()).find(
			(candidate) => candidate.id === id,
		);
		if (!skill) throw new Error(`Skill not found: ${id}`);
		const updated = { ...skill, status, updatedAt: new Date().toISOString() };
		await this.store.putSkill(updated);
		return updated;
	}

	async recordOutcome(id: string, success: boolean): Promise<SkillDefinition> {
		const skill = (await this.store.listSkills()).find(
			(candidate) => candidate.id === id,
		);
		if (!skill) throw new Error(`Skill not found: ${id}`);
		const updated: SkillDefinition = {
			...skill,
			successCount: skill.successCount + (success ? 1 : 0),
			failureCount: skill.failureCount + (success ? 0 : 1),
			updatedAt: new Date().toISOString(),
		};
		await this.store.putSkill(updated);
		return updated;
	}
}
