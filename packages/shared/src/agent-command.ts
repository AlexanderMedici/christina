export const AGENT_TYPES = [
	"claude",
	"openclaude",
	"codex",
	"gemini",
	"opencode",
	"copilot",
	"cursor-agent",
	"kimi",
	"minimax",
	"glm",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];
export type AgentSafetyMode = "review" | "workspace" | "unrestricted";

export const DEFAULT_AGENT_SAFETY_MODE: AgentSafetyMode = "workspace";

export const AGENT_LABELS: Record<AgentType, string> = {
	claude: "Claude",
	openclaude: "OpenClaude",
	codex: "Codex",
	gemini: "Gemini",
	opencode: "OpenCode",
	copilot: "Copilot",
	"cursor-agent": "Cursor Agent",
	kimi: "Kimi K2.7",
	minimax: "MiniMax M3",
	glm: "GLM 5.2",
};

interface RuntimeSpec {
	binary: string;
	baseArgs: string[];
	env?: Record<string, string>;
	argsBySafety?: Partial<Record<AgentSafetyMode, string[]>>;
}

const OPENROUTER_ENV = {
	ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
	ANTHROPIC_AUTH_TOKEN: "$OPENROUTER_API_KEY",
	ANTHROPIC_API_KEY: "",
};

const RUNTIME_SPECS: Record<AgentType, RuntimeSpec> = {
	openclaude: {
		binary: "openclaude",
		baseArgs: ["--print", "--output-format", "stream-json", "--verbose"],
		argsBySafety: {
			review: ["--permission-mode", "plan"],
			workspace: ["--permission-mode", "acceptEdits"],
			unrestricted: [
				"--permission-mode",
				"bypassPermissions",
				"--dangerously-skip-permissions",
			],
		},
	},
	claude: {
		binary: "claude",
		baseArgs: [],
		argsBySafety: { unrestricted: ["--dangerously-skip-permissions"] },
	},
	codex: {
		binary: "codex",
		baseArgs: [
			"--model",
			"gpt-5.5",
			"-c",
			'model_reasoning_effort="high"',
			"-c",
			'model_reasoning_summary="detailed"',
			"-c",
			"model_supports_reasoning_summaries=true",
		],
		argsBySafety: {
			review: ["--ask-for-approval", "on-request", "--sandbox", "read-only"],
			workspace: [
				"--ask-for-approval",
				"on-request",
				"--sandbox",
				"workspace-write",
			],
			unrestricted: [
				"--ask-for-approval",
				"never",
				"--sandbox",
				"danger-full-access",
			],
		},
	},
	gemini: {
		binary: "gemini",
		baseArgs: [],
		argsBySafety: { unrestricted: ["--yolo"] },
	},
	opencode: { binary: "opencode", baseArgs: [] },
	copilot: {
		binary: "copilot",
		baseArgs: [],
		argsBySafety: { unrestricted: ["--allow-all"] },
	},
	"cursor-agent": {
		binary: "cursor-agent",
		baseArgs: [],
		argsBySafety: { unrestricted: ["--yolo"] },
	},
	kimi: {
		binary: "claude",
		baseArgs: ["--model", "moonshotai/kimi-k2.7-code"],
		env: OPENROUTER_ENV,
		argsBySafety: { unrestricted: ["--dangerously-skip-permissions"] },
	},
	minimax: {
		binary: "claude",
		baseArgs: ["--model", "minimax/minimax-m3"],
		env: OPENROUTER_ENV,
		argsBySafety: { unrestricted: ["--dangerously-skip-permissions"] },
	},
	glm: {
		binary: "claude",
		baseArgs: ["--model", "z-ai/glm-5.2"],
		env: OPENROUTER_ENV,
		argsBySafety: { unrestricted: ["--dangerously-skip-permissions"] },
	},
};

export const AGENT_PRESET_DESCRIPTIONS: Record<AgentType, string> = {
	claude: "Workspace mode: approval remains enabled for sensitive actions",
	openclaude: "Structured OpenClaude stream with host-owned run tracking",
	codex: "Workspace-write sandbox with approval for elevated actions",
	gemini: "Standard permission mode; unrestricted mode is opt-in",
	opencode: "Open-source coding-agent runtime",
	copilot: "Standard permission mode; unrestricted mode is opt-in",
	"cursor-agent": "Standard permission mode; unrestricted mode is opt-in",
	kimi: "Kimi via Claude Code and OpenRouter; safe permissions by default",
	minimax: "MiniMax via Claude Code and OpenRouter; safe permissions by default",
	glm: "GLM via Claude Code and OpenRouter; safe permissions by default",
};

export interface PortableLaunchConfig {
	binary: string;
	args: string[];
	env: Record<string, string>;
}

const PORTABLE_NODE_LAUNCHER = String.raw`const c=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));const e={...process.env,...c.env};for(const[k,v]of Object.entries(e)){if(typeof v==='string'&&v.charCodeAt(0)===36)e[k]=process.env[v.slice(1)]||''}const s=require('node:child_process');let b=c.binary,a=c.args;if(process.platform==='win32'){const w=s.spawnSync('where.exe',[b],{encoding:'utf8',windowsHide:true});const r=(w.stdout||'').split(/\r?\n/).find(Boolean);if(r){const d=String.fromCharCode(36);const ps='& '+d+'args[0] @('+d+'args[1..('+d+'args.Count-1)])';const q=String.fromCharCode(92);const root=process.env.SystemRoot||['C:','Windows'].join(q);b=require('node:path').win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');a=['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-Command',ps,r,...a]}}const p=s.spawn(b,a,{stdio:'inherit',env:e,shell:false,windowsHide:false});p.on('error',x=>{console.error('ADE could not launch '+c.binary+': '+x.message);process.exit(127)});p.on('exit',n=>process.exit(n??1));`;

function utf8ToBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return globalThis.btoa(binary);
}

function buildPortableLaunchCommand(config: PortableLaunchConfig): string {
	const payload = utf8ToBase64(JSON.stringify(config));
	return `node -e "${PORTABLE_NODE_LAUNCHER}" "${payload}"`;
}

export function getAgentLaunchConfig({
	agent,
	safetyMode = DEFAULT_AGENT_SAFETY_MODE,
	prompt,
}: {
	agent: AgentType;
	safetyMode?: AgentSafetyMode;
	prompt?: string;
}): PortableLaunchConfig {
	const spec = RUNTIME_SPECS[agent];
	const args = [
		...spec.baseArgs,
		...(spec.argsBySafety?.[safetyMode] ?? []),
	];

	if (prompt !== undefined) {
		if (agent === "opencode") args.push("--prompt", prompt);
		else if (agent === "copilot") args.push("-i", prompt);
		else if (agent === "codex") args.push("--", prompt);
		else args.push(prompt);
	}

	return { binary: spec.binary, args, env: { ...(spec.env ?? {}) } };
}

export function buildAgentPresetCommand(
	agent: AgentType,
	safetyMode: AgentSafetyMode = DEFAULT_AGENT_SAFETY_MODE,
): string {
	return buildPortableLaunchCommand(getAgentLaunchConfig({ agent, safetyMode }));
}

export const AGENT_PRESET_COMMANDS: Record<AgentType, string[]> = Object.fromEntries(
	AGENT_TYPES.map((agent) => [agent, [buildAgentPresetCommand(agent)]]),
) as Record<AgentType, string[]>;

export interface TaskInput {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	priority: string;
	statusName: string | null;
	labels: string[] | null;
}

function buildPrompt(task: TaskInput, safetyMode: AgentSafetyMode): string {
	const metadata = [
		`Priority: ${task.priority}`,
		task.statusName && `Status: ${task.statusName}`,
		task.labels?.length && `Labels: ${task.labels.join(", ")}`,
	]
		.filter(Boolean)
		.join("\n");

	const safetyInstruction =
		safetyMode === "review"
			? "Inspect and propose a plan. Do not modify files or run destructive commands until the user approves."
			: safetyMode === "workspace"
				? "Work autonomously inside the repository. Ask before destructive actions, external publishing, credential changes, or operations outside the workspace."
				: "Work fully autonomously. This unrestricted mode was explicitly selected by the user.";

	return `You are working on task "${task.title}" (${task.slug}).

${metadata}

## Task Description

${task.description || "No description provided."}

## Operating Mode

${safetyInstruction}

## Instructions

1. Explore the codebase and identify the relevant architecture.
2. Create a concise execution plan with assumptions, files, and validation.
3. Implement the plan within the selected operating mode.
4. Run the relevant tests, typecheck, and lint checks.
5. Summarize changes, validation results, and remaining risks.
6. When available, use the Superset MCP \`update_task\` tool to update task "${task.id}".`;
}

export function buildAgentPromptCommand({
	prompt,
	randomId: _randomId,
	agent = "claude",
	safetyMode = DEFAULT_AGENT_SAFETY_MODE,
}: {
	prompt: string;
	randomId: string;
	agent?: AgentType;
	safetyMode?: AgentSafetyMode;
}): string {
	return buildPortableLaunchCommand(
		getAgentLaunchConfig({ agent, safetyMode, prompt }),
	);
}

export function buildAgentCommand({
	task,
	randomId,
	agent = "claude",
	safetyMode = DEFAULT_AGENT_SAFETY_MODE,
}: {
	task: TaskInput;
	randomId: string;
	agent?: AgentType;
	safetyMode?: AgentSafetyMode;
}): string {
	return buildAgentPromptCommand({
		prompt: buildPrompt(task, safetyMode),
		randomId,
		agent,
		safetyMode,
	});
}

/** @deprecated Use `buildAgentCommand` instead. */
export function buildClaudeCommand({
	task,
	randomId,
}: {
	task: TaskInput;
	randomId: string;
}): string {
	return buildAgentCommand({ task, randomId, agent: "claude" });
}
