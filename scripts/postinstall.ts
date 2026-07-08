if (process.env.ADE_POSTINSTALL_RUNNING === "1") process.exit(0);
process.env.ADE_POSTINSTALL_RUNNING = "1";

function run(command: string[]) {
	const result = Bun.spawnSync(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: process.env });
	if (result.exitCode !== 0) process.exit(result.exitCode);
}

run(["bunx", "sherif"]);
run(["bun", "run", "--filter=@ade/desktop", "install:deps"]);
