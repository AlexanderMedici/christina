import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const commit = process.argv[2];
let refArgs: string[] = [];
if (commit) {
	const rev = spawnSync("git", ["rev-parse", commit], {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "inherit"],
	});
	if (rev.status !== 0) process.exit(rev.status ?? 1);
	const sha = (rev.stdout ?? "").trim();
	const branch = `canary-release-${sha.slice(0, 9)}`;
	const push = spawnSync(
		"git",
		["push", "origin", `${sha}:refs/heads/${branch}`],
		{ stdio: "inherit" },
	);
	if (push.status !== 0) process.exit(push.status ?? 1);
	refArgs = ["-f", `ref=${branch}`];
}

const launch = spawnSync(
	"gh",
	[
		"workflow",
		"run",
		"release-desktop-canary.yml",
		"-f",
		"force_build=true",
		...refArgs,
	],
	{ stdio: "inherit" },
);
if (launch.status !== 0) process.exit(launch.status ?? 1);
await sleep(2000);
const list = spawnSync(
	"gh",
	[
		"run",
		"list",
		"--workflow=release-desktop-canary.yml",
		"--limit=1",
		"--json",
		"url",
		"-q",
		".[0].url",
	],
	{ stdio: "inherit" },
);
process.exit(list.status ?? 1);
