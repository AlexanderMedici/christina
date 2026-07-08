import type { RuntimeRegistry } from "./runtime";
import type { DiagnosticReport, RuntimeDiagnostic } from "./types";

function scoreRuntime(input: RuntimeDiagnostic): number {
	if (!input.health.available) return 0;
	let score = 50;
	if (input.capabilities.streaming) score += 10;
	if (input.capabilities.cancellation) score += 10;
	if (input.capabilities.resume) score += 10;
	if (input.capabilities.structuredToolEvents) score += 10;
	if (input.capabilities.nativeApprovals) score += 5;
	if (input.capabilities.structuredOutput) score += 3;
	if (input.capabilities.checkpoints) score += 2;
	return score;
}

export class RuntimeDoctorService {
	constructor(private readonly runtimes: RuntimeRegistry) {}

	async inspect(): Promise<DiagnosticReport> {
		const diagnostics = await Promise.all(
			this.runtimes.list().map(async (runtime): Promise<RuntimeDiagnostic> => {
				const started = Date.now();
				const health = await runtime.healthCheck();
				const warnings: string[] = [];
				if (!health.available) warnings.push("Runtime executable is unavailable.");
				if (!runtime.capabilities.resume) warnings.push("Sessions cannot be resumed natively.");
				if (!runtime.capabilities.structuredToolEvents) {
					warnings.push("Tool activity is inferred from terminal output rather than structured events.");
				}
				const diagnostic: RuntimeDiagnostic = {
					runtimeId: runtime.id,
					health: { ...health, latencyMs: Date.now() - started },
					capabilities: runtime.capabilities,
					score: 0,
					warnings,
				};
				diagnostic.score = scoreRuntime(diagnostic);
				return diagnostic;
			}),
		);
		diagnostics.sort((a, b) => b.score - a.score || a.runtimeId.localeCompare(b.runtimeId));
		const warnings: string[] = [];
		if (!diagnostics.some((item) => item.health.available)) {
			warnings.push("No configured agent runtime is currently available.");
		}
		return {
			generatedAt: new Date().toISOString(),
			platform: process.platform,
			nodeVersion: process.version,
			runtimes: diagnostics,
			recommendedRuntimeId: diagnostics.find((item) => item.health.available)?.runtimeId,
			warnings,
		};
	}
}
