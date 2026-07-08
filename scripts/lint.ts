const processResult = Bun.spawnSync(["bunx", "biome", "check", ...process.argv.slice(2)], {
	stdout: "pipe",
	stderr: "pipe",
});
const output = `${processResult.stdout.toString()}${processResult.stderr.toString()}`;
process.stdout.write(output);
const hasDiagnostics = /Found \d+ (?:error|info|warning)/.test(output);
process.exit(hasDiagnostics ? 1 : processResult.exitCode);
