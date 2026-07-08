import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SpecialistAgentId } from "../packages/agent-kernel/src/index";
import {
	createKernel,
	localProfilePath,
	readLocalProfile,
	saveLocalProfile,
} from "./christina-cli";

interface CliOptions {
	command: string;
	json: boolean;
	outFile?: string;
	provider?: "ollama" | "lmstudio" | "local-openai" | "auto";
	model?: string;
	agentId: SpecialistAgentId | "ORCHESTRATOR";
	request: string;
	minimumScore: number;
}

function parseArgs(argv: string[]): CliOptions {
	const command = argv[0] ?? "help";
	const values = new Map<string, string>();
	for (let index = 1; index < argv.length; index += 1) {
		const item = argv[index];
		if (!item?.startsWith("--")) continue;
		const value = argv[index + 1];
		if (value && !value.startsWith("--")) {
			values.set(item.slice(2), value);
			index += 1;
		} else {
			values.set(item.slice(2), "true");
		}
	}
	const requestedProvider = values.get("provider");
	return {
		command,
		json: values.get("json") === "true",
		outFile: values.get("out"),
		provider:
			requestedProvider === "ollama" ||
			requestedProvider === "lmstudio" ||
			requestedProvider === "local-openai" ||
			requestedProvider === "auto"
				? requestedProvider
				: undefined,
		model: values.get("model"),
		agentId: (values.get("agent")?.trim().toUpperCase() as SpecialistAgentId) ?? "CODER",
		request:
			values.get("request") ??
			"Select the best local model for code editing, repository analysis, and terminal-oriented development work.",
		minimumScore: Number(values.get("minimum-score") ?? 60),
	};
}

function printHelp(): void {
	console.log(`CHRISTINA runtime tools

Commands:
  doctor [--json] [--out FILE]
    Inspect registered runtimes, local model providers, and the saved local profile.

  recommend [--provider auto|ollama|lmstudio|local-openai] [--agent CODER] [--request "..."] [--minimum-score 60] [--json]
    Rank local model candidates and print the best recommendation.

  profile:init [--provider auto|ollama|lmstudio|local-openai] [--model MODEL] [--agent CODER] [--request "..."] [--minimum-score 60] [--json]
    Save a default local model profile to ${localProfilePath()}.
`);
}

async function rankCandidates(options: CliOptions) {
	const kernel = await createKernel();
	const ranking = await kernel.localModels.rank({
		agentId: options.agentId,
		request: options.request,
		providerIds:
			options.provider && options.provider !== "auto" ? [options.provider] : undefined,
		preferredModel: options.model,
		minimumScore: 0,
	});
	return ranking;
}

function printRecommendation(payload: {
	selected?: { providerId: string; model: string; score: number; reasons: string[] };
	ranking: Array<{ providerId: string; model: string; score: number; reasons: string[] }>;
}): void {
	if (!payload.selected) {
		console.log("No suitable local model was found.");
		return;
	}
	console.log(`Recommended provider: ${payload.selected.providerId}`);
	console.log(`Recommended model: ${payload.selected.model}`);
	console.log(`Score: ${payload.selected.score}`);
	console.log(`Reasons: ${payload.selected.reasons.join(" | ")}`);
	if (payload.ranking.length > 1) {
		console.log("\nTop candidates:");
		for (const [index, candidate] of payload.ranking.slice(0, 5).entries()) {
			console.log(
				`${index + 1}. ${candidate.providerId} / ${candidate.model} | score=${candidate.score}`,
			);
		}
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options.command === "help" || options.command === "--help" || options.command === "-h") {
		printHelp();
		return;
	}
	if (options.command === "doctor") {
		const kernel = await createKernel();
		const report = {
			generatedAt: new Date().toISOString(),
			profilePath: localProfilePath(),
			savedProfile: readLocalProfile(),
			systemMemory: kernel.localModels.systemMemory(),
			runtimeDoctor: await kernel.doctor.inspect(),
			localProviders: await kernel.localModels.inspectProviders(),
			localModels: await kernel.localModels.discover({ refresh: true }),
		};
		if (options.outFile) {
			const outFile = resolve(options.outFile);
			mkdirSync(dirname(outFile), { recursive: true });
			writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
		}
		if (options.json || options.outFile) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}
		console.log(`Recommended runtime: ${report.runtimeDoctor.recommendedRuntimeId ?? "none"}`);
		console.log(`Saved profile: ${report.savedProfile ? `${report.savedProfile.provider} / ${report.savedProfile.model}` : "none"}`);
		for (const provider of report.localProviders) {
			console.log(
				`${provider.id}: ${provider.health.available ? "available" : "unavailable"} | models=${provider.modelCount} | ${provider.baseUrl}`,
			);
		}
		if (report.runtimeDoctor.warnings.length > 0) {
			console.log(`Warnings: ${report.runtimeDoctor.warnings.join(" | ")}`);
		}
		return;
	}
	if (options.command === "recommend") {
		const ranking = await rankCandidates(options);
		const selected = ranking.find((item) => item.score >= options.minimumScore);
		const payload = { selected, ranking };
		if (options.json) {
			console.log(JSON.stringify(payload, null, 2));
			return;
		}
		printRecommendation({
			selected: selected
				? {
						providerId: selected.providerId,
						model: selected.model,
						score: selected.score,
						reasons: selected.reasons,
					}
				: undefined,
			ranking: ranking.map((item) => ({
				providerId: item.providerId,
				model: item.model,
				score: item.score,
				reasons: item.reasons,
			})),
		});
		return;
	}
	if (options.command === "profile:init") {
		const ranking = await rankCandidates(options);
		const selected =
			(options.provider && options.provider !== "auto" && options.model
				? ranking.find(
						(item) =>
							item.providerId === options.provider && item.model === options.model,
					)
				: undefined) ??
			ranking.find((item) => item.score >= options.minimumScore);
		if (!selected) {
			throw new Error("No suitable local model is available to save as the default profile.");
		}
		const profile = {
			provider: selected.providerId as "ollama" | "lmstudio" | "local-openai",
			model: selected.model,
			createdAt: new Date().toISOString(),
		};
		const path = saveLocalProfile(profile);
		const payload = { path, profile, score: selected.score, reasons: selected.reasons };
		if (options.json) {
			console.log(JSON.stringify(payload, null, 2));
			return;
		}
		console.log(`Saved local profile: ${profile.provider} / ${profile.model}`);
		console.log(`Path: ${path}`);
		console.log(`Score: ${selected.score}`);
		return;
	}
	throw new Error(`Unknown command: ${options.command}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
