import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const processResult = spawnSync(
	pnpm,
	["exec", "biome", "check", ...process.argv.slice(2)],
	{
		encoding: "utf8",
	},
);
const output = `${processResult.stdout ?? ""}${processResult.stderr ?? ""}`;
process.stdout.write(output);
const hasDiagnostics = /Found \d+ (?:error|info|warning)/.test(output);
process.exit(hasDiagnostics ? 1 : (processResult.status ?? 1));
