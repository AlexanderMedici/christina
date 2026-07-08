import { randomUUID } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { HookEngine } from "./hooks";
import { runProcess } from "./process";
import type { AgentKernelStore } from "./store";
import type { CheckpointFile, CheckpointRecord } from "./types";

function ensureInside(root: string, candidate: string): string {
	const resolvedRoot = resolve(root);
	const resolvedCandidate = resolve(candidate);
	const rel = relative(resolvedRoot, resolvedCandidate);
	if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
		return resolvedCandidate;
	}
	throw new Error(`Checkpoint path escapes the workspace: ${candidate}`);
}

async function git(
	cwd: string,
	args: string[],
	options: { stdin?: string; timeoutMs?: number } = {},
): Promise<string> {
	const result = await runProcess({
		binary: "git",
		args,
		cwd,
		stdin: options.stdin,
		timeoutMs: options.timeoutMs ?? 30_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.trim() || `git ${args[0]} failed.`);
	}
	return result.stdout;
}

export class CheckpointService {
	constructor(
		private readonly store: AgentKernelStore,
		private readonly hooks?: HookEngine,
	) {}

	async create(input: {
		runId?: string;
		sessionId: string;
		workspaceId: string;
		workspaceRoot: string;
		label: string;
		reason?: string;
		maxFileBytes?: number;
		maxTotalBytes?: number;
	}): Promise<CheckpointRecord> {
		const hook = await this.hooks?.execute({
			event: "checkpoint.before",
			runId: input.runId,
			sessionId: input.sessionId,
			workspaceId: input.workspaceId,
			workspaceRoot: input.workspaceRoot,
			payload: { action: "create", label: input.label },
		});
		if (hook && !hook.continue) {
			throw new Error(hook.reason ?? "Checkpoint creation was blocked by a hook.");
		}

		const root = resolve(input.workspaceRoot);
		const detectedRoot = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
		if (resolve(detectedRoot) !== root) {
			throw new Error(
				`Checkpoint root must be the Git worktree root. Expected ${detectedRoot}.`,
			);
		}
		const gitHead = (await git(root, ["rev-parse", "HEAD"])).trim();
		const trackedPatch = await git(root, [
			"diff",
			"--binary",
			"--no-ext-diff",
			"HEAD",
			"--",
			".",
		]);
		const untrackedRaw = await git(root, [
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
		]);
		const maxFileBytes = input.maxFileBytes ?? 2 * 1024 * 1024;
		const maxTotalBytes = input.maxTotalBytes ?? 20 * 1024 * 1024;
		let totalBytes = Buffer.byteLength(trackedPatch, "utf8");
		const untrackedFiles: CheckpointFile[] = [];
		const skippedFiles: string[] = [];
		for (const path of untrackedRaw.split("\0").filter(Boolean)) {
			try {
				const absolute = ensureInside(root, join(root, path));
				const stat = await lstat(absolute);
				if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFileBytes) {
					skippedFiles.push(path);
					continue;
				}
				if (totalBytes + stat.size > maxTotalBytes) {
					skippedFiles.push(path);
					continue;
				}
				const content = await readFile(absolute);
				totalBytes += content.byteLength;
				untrackedFiles.push({
					path,
					contentBase64: content.toString("base64"),
					mode: stat.mode,
				});
			} catch {
				skippedFiles.push(path);
			}
		}

		const checkpoint: CheckpointRecord = {
			id: randomUUID(),
			runId: input.runId,
			sessionId: input.sessionId,
			workspaceId: input.workspaceId,
			workspaceRoot: root,
			label: input.label,
			reason: input.reason,
			gitHead,
			trackedPatch,
			untrackedFiles,
			skippedFiles,
			complete: skippedFiles.length === 0,
			createdAt: new Date().toISOString(),
		};
		await this.store.putCheckpoint(checkpoint);
		await this.hooks?.execute({
			event: "checkpoint.after",
			runId: input.runId,
			sessionId: input.sessionId,
			workspaceId: input.workspaceId,
			workspaceRoot: root,
			payload: { action: "create", checkpoint },
		});
		return checkpoint;
	}

	async restore(input: {
		checkpointId: string;
		force: boolean;
		allowIncomplete?: boolean;
	}): Promise<CheckpointRecord> {
		if (!input.force) {
			throw new Error("Checkpoint restore is destructive and requires force=true.");
		}
		const checkpoint = await this.store.getCheckpoint(input.checkpointId);
		if (!checkpoint) throw new Error(`Checkpoint not found: ${input.checkpointId}`);
		if (!checkpoint.complete && !input.allowIncomplete) {
			throw new Error(
				"Checkpoint omitted one or more files. Set allowIncomplete=true to restore it anyway.",
			);
		}
		const hook = await this.hooks?.execute({
			event: "checkpoint.before",
			runId: checkpoint.runId,
			sessionId: checkpoint.sessionId,
			workspaceId: checkpoint.workspaceId,
			workspaceRoot: checkpoint.workspaceRoot,
			payload: { action: "restore", checkpointId: checkpoint.id },
		});
		if (hook && !hook.continue) {
			throw new Error(hook.reason ?? "Checkpoint restoration was blocked by a hook.");
		}

		const root = resolve(checkpoint.workspaceRoot);
		await git(root, ["reset", "--hard", checkpoint.gitHead]);
		await git(root, ["clean", "-fd"]);
		if (checkpoint.trackedPatch.trim()) {
			const tempDir = await mkdtemp(join(tmpdir(), "damon-checkpoint-"));
			const patchPath = join(tempDir, "workspace.patch");
			try {
				await writeFile(patchPath, checkpoint.trackedPatch, "utf8");
				await git(root, [
					"apply",
					"--binary",
					"--whitespace=nowarn",
					patchPath,
				]);
			} finally {
				await rm(tempDir, { recursive: true, force: true });
			}
		}
		for (const file of checkpoint.untrackedFiles) {
			const absolute = ensureInside(root, join(root, file.path));
			await mkdir(dirname(absolute), { recursive: true });
			await writeFile(absolute, Buffer.from(file.contentBase64, "base64"));
			if (file.mode !== undefined && process.platform !== "win32") {
				await chmod(absolute, file.mode);
			}
		}
		const updated: CheckpointRecord = {
			...checkpoint,
			restoredAt: new Date().toISOString(),
		};
		await this.store.putCheckpoint(updated);
		await this.hooks?.execute({
			event: "checkpoint.after",
			runId: checkpoint.runId,
			sessionId: checkpoint.sessionId,
			workspaceId: checkpoint.workspaceId,
			workspaceRoot: root,
			payload: { action: "restore", checkpoint: updated },
		});
		return updated;
	}
}
