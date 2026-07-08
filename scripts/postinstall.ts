import { spawnSync } from "node:child_process";

if (process.env.ADE_POSTINSTALL_RUNNING === "1") process.exit(0);
process.env.ADE_POSTINSTALL_RUNNING = "1";

function run(command: string[]) {
	const [bin, ...args] = command;
	const result = spawnSync(bin, args, {
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

run([pnpm, "exec", "sherif"]);
run([pnpm, "--filter", "@ade/desktop", "install:deps"]);
