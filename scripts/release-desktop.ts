import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
	console.error("Usage: pnpm release:desktop <version>");
	process.exit(2);
}

function run(command: string[]) {
	const [bin, ...args] = command;
	const result = spawnSync(bin, args, {
		stdio: "inherit",
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const status = spawnSync("git", ["status", "--porcelain"], {
	encoding: "utf8",
});
if ((status.stdout ?? "").trim()) {
	console.error("Working tree must be clean before creating a release.");
	process.exit(1);
}

run(["gh", "auth", "status"]);
const packagePath = resolve("apps/desktop/package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
pkg.version = version;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, "\t")}\n`);

const tag = `desktop-v${version}`;
run(["git", "add", packagePath]);
run(["git", "commit", "-m", `chore(desktop): release ${version}`]);
run(["git", "tag", tag]);
run(["git", "push", "origin", "HEAD"]);
run(["git", "push", "origin", tag]);
console.log(`Release workflow triggered by ${tag}.`);
