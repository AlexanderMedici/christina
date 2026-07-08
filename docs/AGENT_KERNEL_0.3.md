# Damon ADE 0.3 Agent Kernel

## Purpose

Version 0.3 introduces a host-owned agent kernel. The kernel is the first step from a terminal launcher toward a consistent agent harness in which Damon owns sessions, runs, context, policy, memory review, skills, and audit history while Claude, Codex, Gemini, OpenCode, Cursor, and other CLIs act as replaceable runtime adapters.

The existing terminal workflow remains available for compatibility. The new kernel is exposed through the desktop tRPC API and can run agents headlessly while preserving a normalized event history.

## Architecture

```text
Desktop UI / MCP / future channels
              |
       Damon control plane
              |
  +-----------+------------+
  |           |            |
Context     Policy       Memory/Skills
Engine      Engine       Review lifecycle
  |           |            |
  +-----------+------------+
              |
        PreparedRun
              |
       Runtime Registry
  +-----+-----+------+------+
Claude Codex Gemini OpenCode ...
              |
    Cross-platform process layer
```

## Implemented in 0.3

### Host-owned sessions and runs

Damon now creates its own session and run identifiers. Runtime-specific session identifiers are secondary metadata rather than the authoritative record.

Run states:

- `queued`
- `running`
- `waiting_for_approval`
- `completed`
- `failed`
- `cancelled`

Interrupted `queued`, `running`, and `waiting_for_approval` runs are marked `failed` with a retryable `host_restarted` error at the next startup.

### Prepared run contract

Every run contains:

- Damon session and run IDs
- runtime ID
- workspace ID and root
- safety mode
- original user prompt
- assembled context package
- model override
- environment references
- metadata

### Normalized event stream

All runtimes emit the same event family:

- run lifecycle
- assistant output
- stderr
- plans
- tool requests/results
- permission requests
- artifacts
- usage
- checkpoints

The initial CLI adapters emit lifecycle, output, stderr, usage, completion, failure, and cancellation events. Structured tool and plan events can be added by runtime-specific parsers without changing the host API.

### Durable local storage

Kernel records are stored under:

```text
<ADE_HOME_DIR>/agent-kernel/
├── sessions/
├── runs/
├── events/
├── approvals/
├── memory/
├── skills/
└── tasks/
```

Records use human-readable JSON and JSONL. Writes are isolated from project repositories.

### Context engine

The context engine:

- accepts typed context blocks
- estimates token use
- respects model budget and output reserve
- prioritizes important blocks
- records omitted blocks
- renders one deterministic context package

This is the foundation for later transcript compaction, semantic retrieval, and model-specific budgets.

### Policy and approvals

The default policy engine:

- makes review mode read-only
- confines normal file access to the workspace
- denies direct credential-store access
- requires approval for deletion, publishing, pushing, and external messaging
- detects common destructive and publishing commands

Approval records are durable and reviewable through tRPC.

Important limitation: generic CLI adapters cannot intercept every internal tool call made by third-party CLIs. Full enforcement requires native runtime adapters that route tool calls through the host-owned gateway. The gateway, policy API, and approval lifecycle are now in place for that next step.

### Reviewed memory lifecycle

Memory records are typed as facts, episodes, or procedures and move through:

```text
proposed -> active / rejected / superseded
```

Only active, unexpired memory is returned by search. Search currently combines lexical overlap with confidence. This intentionally avoids silently rewriting permanent memory.

### Skills lifecycle

Skills now have:

- versions
- descriptions and triggers
- required tools
- draft/active/disabled status
- success and failure counts
- relevance-based selection

Full skill package signing and automatic instruction loading remain future work.

### Host-owned tool gateway

The tool gateway provides a runtime-neutral registry for native tools. It checks required scopes, creates a policy operation, returns durable approval requests for elevated actions, enforces timeouts, and truncates oversized output. Generic third-party CLIs still remain opaque until native adapters route their tool calls through this gateway.

### Durable task graphs

The task graph service stores dependency-aware multi-agent work. It validates task keys and dependencies, rejects cycles, identifies ready tasks, blocks dependants when prerequisites fail, tracks attempts, and persists assignments, runtime choices, priorities, and output artifacts. Automatic dispatch from ready tasks into agent runs is the next orchestration step.

### Cross-platform CLI adapter

The adapter uses argument arrays with `shell: false`.

- macOS/Linux: direct executable spawning
- Windows executables: direct spawning
- Windows `.cmd`/`.bat` shims: a fixed PowerShell bridge with user data passed as arguments
- Windows cancellation: `taskkill /t /f`
- macOS/Linux cancellation: `SIGTERM`

Prompt text is never interpolated into a shell command.

## Desktop tRPC surface

The new `agentKernel` router provides:

- `start`
- `cancel`
- `sessions`
- `runs`
- `run`
- `events`
- `runtimeHealth`
- `evaluatePolicy`
- `approvals`
- `requestApproval`
- `resolveApproval`
- `proposeMemory`
- `reviewMemory`
- `searchMemory`
- `createSkill`
- `selectSkills`
- `updateSkillStatus`
- `recordSkillOutcome`
- `listTools`
- `createTaskGraph`
- `tasks`
- `readyTasks`
- `updateTask`

## Next recommended work

1. Add a Run Timeline and Approval Inbox to the desktop UI.
2. Build native structured adapters for Claude Code and Codex.
3. Route native Claude and Codex tool calls through the host-owned tool gateway.
4. Add transcript compaction and hybrid semantic/keyword retrieval.
5. Add Docker, WSL, and SSH execution backends.
6. Add automatic task dispatch, subagent spawning, budgets, and checkpoints.
7. Add runtime replay and comparative evaluation.
