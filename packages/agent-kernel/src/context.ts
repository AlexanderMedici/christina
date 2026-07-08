import type {
	ContextBlock,
	ContextCompactionRecord,
	ContextPackage,
} from "./types";

export interface ContextBuildRequest {
	blocks: ContextBlock[];
	budget?: number;
	reserve?: number;
}

export function estimateTokens(content: string): number {
	return Math.max(1, Math.ceil(content.length / 4));
}

function collapseWhitespace(content: string): string {
	return content
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function sliceByApproxTokens(content: string, tokens: number): string {
	return content.slice(0, Math.max(1, tokens * 4));
}

function compactBlock(
	block: ContextBlock,
	targetTokens: number,
): { block: ContextBlock; record: ContextCompactionRecord } | undefined {
	const originalTokens = block.estimatedTokens ?? estimateTokens(block.content);
	if (targetTokens < 32 || originalTokens <= targetTokens) return undefined;

	const normalized = collapseWhitespace(block.content);
	const normalizedTokens = estimateTokens(normalized);
	if (normalizedTokens <= targetTokens) {
		return {
			block: { ...block, content: normalized, estimatedTokens: normalizedTokens },
			record: {
				blockId: block.id,
				originalTokens,
				compactedTokens: normalizedTokens,
				strategy: "whitespace",
			},
		};
	}

	if (block.kind === "transcript") {
		const marker = "[Earlier transcript content compacted by CHRISTINA]\n\n";
		const markerTokens = estimateTokens(marker);
		const tailBudget = Math.max(16, targetTokens - markerTokens);
		const tailChars = tailBudget * 4;
		const content = `${marker}${normalized.slice(-tailChars)}`;
		const compactedTokens = estimateTokens(content);
		return {
			block: { ...block, content, estimatedTokens: compactedTokens },
			record: {
				blockId: block.id,
				originalTokens,
				compactedTokens,
				strategy: "transcript_tail",
			},
		};
	}

	const marker = "\n\n[Middle content compacted by CHRISTINA]\n\n";
	const markerTokens = estimateTokens(marker);
	const contentBudget = Math.max(16, targetTokens - markerTokens);
	const headTokens = Math.ceil(contentBudget * 0.6);
	const tailTokens = Math.floor(contentBudget * 0.4);
	const head = sliceByApproxTokens(normalized, headTokens);
	const tail = normalized.slice(-tailTokens * 4);
	const content = `${head}${marker}${tail}`;
	const compactedTokens = estimateTokens(content);
	return {
		block: { ...block, content, estimatedTokens: compactedTokens },
		record: {
			blockId: block.id,
			originalTokens,
			compactedTokens,
			strategy: "head_tail",
		},
	};
}

const KIND_ORDER: ContextBlock["kind"][] = [
	"system",
	"agent",
	"policy",
	"project",
	"skill",
	"memory",
	"workspace",
	"hook",
	"mailbox",
	"transcript",
	"task",
];

export class ContextEngine {
	build({
		blocks,
		budget = 100_000,
		reserve = 12_000,
	}: ContextBuildRequest): ContextPackage {
		const usableBudget = Math.max(1, budget - reserve);
		const normalized = blocks.map((block) => ({
			...block,
			estimatedTokens: block.estimatedTokens ?? estimateTokens(block.content),
		}));
		const ordered = [...normalized].sort(
			(a, b) =>
				Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
				b.priority - a.priority ||
				(a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
				a.id.localeCompare(b.id),
		);

		const selected: ContextBlock[] = [];
		const omittedBlockIds: string[] = [];
		const compactions: ContextCompactionRecord[] = [];
		let used = 0;

		for (const block of ordered) {
			const size = block.estimatedTokens ?? 0;
			const remaining = usableBudget - used;
			if (size <= remaining) {
				selected.push(block);
				used += size;
				continue;
			}

			if (block.compactable && remaining >= 32) {
				const target = Math.min(block.maxTokens ?? remaining, remaining);
				const compacted = compactBlock(block, target);
				if (compacted && (compacted.block.estimatedTokens ?? 0) <= remaining) {
					selected.push(compacted.block);
					used += compacted.block.estimatedTokens ?? 0;
					compactions.push(compacted.record);
					continue;
				}
			}
			omittedBlockIds.push(block.id);
		}

		selected.sort(
			(a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
		);

		const rendered = selected
			.map(
				(block) =>
					`## ${block.kind.toUpperCase()}: ${block.id}\n\n${block.content.trim()}`,
			)
			.join("\n\n");

		return {
			blocks: selected,
			rendered,
			estimatedTokens: used,
			omittedBlockIds,
			compactions,
			budget,
			reserve,
		};
	}
}
