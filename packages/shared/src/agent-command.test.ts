import { describe, expect, it } from "bun:test";
import {
	buildAgentPromptCommand,
	buildAgentPresetCommand,
	getAgentLaunchConfig,
} from "./agent-command";

describe("portable agent harness", () => {
	it("defaults Codex to workspace-write instead of danger-full-access", () => {
		const config = getAgentLaunchConfig({ agent: "codex" });
		expect(config.args).toContain("workspace-write");
		expect(config.args).not.toContain("danger-full-access");
	});

	it("makes unrestricted mode explicit", () => {
		const config = getAgentLaunchConfig({
			agent: "claude",
			safetyMode: "unrestricted",
		});
		expect(config.args).toContain("--dangerously-skip-permissions");
	});

	it("uses a portable Node launcher instead of Unix heredocs", () => {
		const command = buildAgentPromptCommand({
			prompt: "hello && echo unsafe",
			randomId: "abcd-efgh",
			agent: "claude",
		});
		expect(command).toStartWith('node -e "');
		expect(command).not.toContain("cat <<");
		expect(command).not.toContain("hello && echo unsafe");
	});

	it("builds portable interactive preset commands", () => {
		const command = buildAgentPresetCommand("opencode");
		expect(command).toStartWith('node -e "');
	});
});
