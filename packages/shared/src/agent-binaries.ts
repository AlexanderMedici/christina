import { type AgentType } from "./agent-command";

export type AgentBinary =
	| "claude"
	| "openclaude"
	| "codex"
	| "opencode"
	| "gemini"
	| "copilot"
	| "cursor-agent"
	| "git";
export type SupportedPlatform = "darwin" | "win32" | "linux";

export const RUNTIME_BINARY: Record<AgentType, AgentBinary> = {
	claude: "claude",
	openclaude: "openclaude",
	codex: "codex",
	gemini: "gemini",
	opencode: "opencode",
	copilot: "copilot",
	"cursor-agent": "cursor-agent",
	kimi: "claude",
	minimax: "claude",
	glm: "claude",
};

export interface BinaryInstallInfo {
	label: string;
	command: string;
	commands?: Partial<Record<SupportedPlatform, string>>;
	url: string;
	note?: string;
}

export const BINARY_INSTALL: Record<AgentBinary, BinaryInstallInfo> = {
	openclaude: {
		label: "OpenClaude",
		command: "npm i -g @gitlawb/openclaude",
		url: "https://github.com/gitlawb/openclaude",
	},
	claude: {
		label: "Claude Code",
		command: "npm i -g @anthropic-ai/claude-code",
		url: "https://claude.com/claude-code",
	},
	codex: {
		label: "Codex CLI",
		command: "npm i -g @openai/codex",
		url: "https://developers.openai.com/codex/cli",
	},
	opencode: {
		label: "OpenCode",
		command: "npm i -g opencode-ai",
		url: "https://opencode.ai/docs",
	},
	gemini: {
		label: "Gemini CLI",
		command: "npm i -g @google/gemini-cli",
		url: "https://github.com/google-gemini/gemini-cli",
	},
	copilot: {
		label: "GitHub Copilot CLI",
		command: "npm i -g @github/copilot",
		url: "https://docs.github.com/en/copilot",
	},
	"cursor-agent": {
		label: "Cursor Agent",
		command: "cursor-agent --version",
		url: "https://cursor.com",
		note: "Install Cursor Agent from the official Cursor documentation.",
	},
	git: {
		label: "Git",
		command: "git --version",
		commands: {
			darwin: "xcode-select --install",
			win32: "winget install --id Git.Git -e --source winget",
			linux: "sudo apt-get update && sudo apt-get install -y git",
		},
		url: "https://git-scm.com/downloads",
	},
};

export function getBinaryInstallCommand(
	binary: AgentBinary,
	platform?: string,
): string {
	const info = BINARY_INSTALL[binary];
	if (platform === "darwin" || platform === "win32" || platform === "linux") {
		return info.commands?.[platform] ?? info.command;
	}
	return info.command;
}

export const CHECKED_BINARIES = [
	"claude",
	"openclaude",
	"codex",
	"opencode",
	"git",
] as const satisfies readonly AgentBinary[];

export type CheckedBinary = (typeof CHECKED_BINARIES)[number];
export type RuntimeAvailability = Record<CheckedBinary, boolean>;
