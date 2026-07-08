const commit = process.argv[2];
let refArgs: string[] = [];
if (commit) {
	const rev = Bun.spawnSync(["git", "rev-parse", commit], { stdout: "pipe", stderr: "inherit" });
	if (rev.exitCode !== 0) process.exit(rev.exitCode);
	const sha = rev.stdout.toString().trim();
	const branch = `canary-release-${sha.slice(0, 9)}`;
	const push = Bun.spawnSync(["git", "push", "origin", `${sha}:refs/heads/${branch}`], { stdout: "inherit", stderr: "inherit" });
	if (push.exitCode !== 0) process.exit(push.exitCode);
	refArgs = ["-f", `ref=${branch}`];
}
const launch = Bun.spawnSync(["gh", "workflow", "run", "release-desktop-canary.yml", "-f", "force_build=true", ...refArgs], { stdout: "inherit", stderr: "inherit" });
if (launch.exitCode !== 0) process.exit(launch.exitCode);
await Bun.sleep(2000);
const list = Bun.spawnSync(["gh", "run", "list", "--workflow=release-desktop-canary.yml", "--limit=1", "--json", "url", "-q", ".[0].url"], { stdout: "inherit", stderr: "inherit" });
process.exit(list.exitCode);
