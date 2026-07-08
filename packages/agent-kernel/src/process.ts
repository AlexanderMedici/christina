import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

export interface SpawnTarget {
	executable: string;
	args: string[];
}

export function resolveEnvironment(
	env: Record<string, string> | undefined,
): Record<string, string> {
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(env ?? {})) {
		resolved[key] = value.startsWith("$")
			? (process.env[value.slice(1)] ?? "")
			: value;
	}
	return resolved;
}

function windowsSpawnTarget(binary: string, args: string[]): SpawnTarget {
	const found = spawnSync("where.exe", [binary], {
		encoding: "utf8",
		windowsHide: true,
	});
	const resolved = String(found.stdout ?? "")
		.split(/\r?\n/)
		.find(Boolean);
	if (!resolved || (!resolved.endsWith(".cmd") && !resolved.endsWith(".bat"))) {
		return { executable: resolved ?? binary, args };
	}

	const root = process.env.SystemRoot ?? "C:\\Windows";
	const executable = join(
		root,
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);
	const script =
		"$exe=$args[0]; if($args.Count -gt 1){& $exe @($args[1..($args.Count-1)])}else{& $exe}; exit $LASTEXITCODE";
	return {
		executable,
		args: [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			script,
			resolved,
			...args,
		],
	};
}

export function resolveSpawnTarget(binary: string, args: string[]): SpawnTarget {
	return process.platform === "win32"
		? windowsSpawnTarget(binary, args)
		: { executable: binary, args };
}

export interface ProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	durationMs: number;
}

export async function runProcess(input: {
	binary: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	stdin?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}): Promise<ProcessResult> {
	const target = resolveSpawnTarget(input.binary, input.args ?? []);
	const started = Date.now();
	const child = spawn(target.executable, target.args, {
		cwd: input.cwd,
		env: { ...process.env, ...resolveEnvironment(input.env) },
		shell: false,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	child.stdout.on("data", (chunk) => {
		stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
	});
	child.stderr.on("data", (chunk) => {
		stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
	});

	const terminate = () => {
		if (child.killed) return;
		if (process.platform === "win32") {
			spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
				windowsHide: true,
			});
		} else {
			child.kill("SIGTERM");
		}
	};
	const onAbort = () => terminate();
	input.signal?.addEventListener("abort", onAbort, { once: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	if (input.timeoutMs) {
		timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, input.timeoutMs);
	}
	if (input.stdin !== undefined) child.stdin.end(input.stdin);
	else child.stdin.end();

	const exitCode = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	if (timer) clearTimeout(timer);
	input.signal?.removeEventListener("abort", onAbort);
	return {
		exitCode,
		stdout,
		stderr,
		timedOut,
		durationMs: Date.now() - started,
	};
}
