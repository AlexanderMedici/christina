# Damon ADE 0.4 — OpenClaude-Inspired Agent Harness

## Purpose

Version 0.4 moves Damon from a durable run launcher toward a host-owned agent execution system. The design was informed by an audit of the uploaded OpenClaude 0.1.6 source, but the additions were implemented as Damon-native, runtime-neutral services.

The central rule remains:

> Damon owns sessions, context, policy, budgets, hooks, checkpoints, mailboxes, and audit history. A model CLI is an interchangeable execution runtime.

## New architecture

```text
Desktop UI / tRPC
        |
Damon Agent Kernel
  |-- durable sessions and runs
  |-- context engine + micro-compaction
  |-- lifecycle hook engine
  |-- session mailbox
  |-- run budgets
  |-- structured-output contracts
  |-- checkpoint service
  |-- policy and approvals
  |-- tool gateway
  |-- runtime doctor
        |
Runtime adapters
  |-- OpenClaude structured adapter
  |-- generic CLI adapter
        |
Mac / Windows process layer (shell: false)
```

## OpenClaude first-class runtime

OpenClaude is now available as the `openclaude` runtime and can be selected when creating an agent or launching from the model bar.

Damon launches it with structured NDJSON output:

```text
--print --output-format stream-json --verbose
```

Safety mappings:

| Damon mode | OpenClaude mode |
|---|---|
| Review | `--permission-mode plan` |
| Workspace | `--permission-mode acceptEdits` |
| Unrestricted | `--permission-mode bypassPermissions --dangerously-skip-permissions` |

The adapter normalizes:

- Native OpenClaude session IDs
- Assistant text
- Tool requests and results
- Permission requests
- Token and cost usage
- Turn counts
- Success and failure results
- Native budget failures

Native session IDs are written into the Damon session and reused through `--resume` on a later run.

## Lifecycle hooks

The host hook engine supports:

- `session.start`
- `run.before`
- `run.after`
- `run.error`
- `tool.before`
- `tool.after`
- `tool.error`
- `permission.request`
- `context.beforeCompact`
- `context.afterCompact`
- `checkpoint.before`
- `checkpoint.after`
- `workspace.changed`

Hooks can be callbacks or portable commands. Command hooks receive a JSON record through standard input and return one JSON object through standard output. They are launched without a shell.

A hook can:

- Block an operation
- Add context
- Add an initial user instruction
- Transform tool input or output
- Recommend allow, deny, or approval
- Request retry
- Attach annotations

Host policy remains authoritative. A hook cannot override a hard policy denial.

## Session mailbox

Messages can be queued against a durable Damon session while another run is active or between runs.

Mailbox lifecycle:

```text
queued -> claimed -> delivered
                  -> queued again after failure/restart
                  -> failed/cancelled
```

Queued messages are inserted as pinned context in the next run. This gives CLI runtimes a safe cross-turn inbox without pretending they support live interruption.

## Context micro-compaction

The context engine no longer relies only on dropping entire low-priority blocks. Compactable blocks can be reduced using deterministic strategies:

- Whitespace reduction
- Head/tail preservation
- Recent transcript-tail preservation

Pinned policy, hook, and mailbox blocks are selected first. Every compaction is recorded as a normalized event with original and resulting token estimates.

## Run budgets

Damon can enforce:

- Maximum duration
- Maximum turns
- Maximum cost
- Maximum input tokens
- Maximum output tokens
- Maximum total tokens
- Maximum tool calls
- Maximum assistant-output characters

The host monitors normalized events and cancels the runtime when a limit is crossed. OpenClaude also receives native `--max-turns` and `--max-budget-usd` flags when those limits are present.

## Structured-output contracts

A run can request text or JSON output and optionally attach a JSON Schema subset. Damon extracts JSON from plain or fenced output and validates:

- Types
- Required properties
- Properties
- Enums
- Additional-property restrictions
- String, number, and array limits

Strict contracts fail the run when validation fails. Non-strict contracts mark the run partial. OpenClaude receives its native `--json-schema` flag while Damon still validates the result independently.

## Reversible checkpoints

Damon can create a Git-backed checkpoint containing:

- Current `HEAD`
- Binary tracked-file patch
- Bounded untracked-file snapshots
- Completeness and skipped-file metadata

Restoring a checkpoint is destructive and requires a durable approved `checkpoint.restore` authorization. Restore uses argument-array process execution, verifies the workspace root, rejects path traversal, and refuses incomplete checkpoints unless explicitly allowed.

## Runtime diagnostics

The runtime doctor checks every adapter and reports:

- Availability
- Version
- Health-check latency
- Capabilities
- Warnings
- A recommended available runtime

Structured, resumable runtimes score above plain terminal runtimes.

## Desktop API additions

The agent-kernel router now exposes operations for:

- Run budgets and output contracts
- Hook listing/registration/removal
- Session mailbox messages
- Checkpoint creation/listing/restore approval
- Runtime diagnostics

## Cross-platform guarantees

The additions follow the same Mac and Windows rules established in 0.2 and 0.3:

- No prompt interpolation into shell commands
- `spawn(executable, args, { shell: false })`
- PowerShell bridge only for Windows `.cmd` and `.bat` shims
- Windows process-tree cancellation
- Atomic file replacement with Windows fallback
- No dependency on Bash heredocs
- Unicode and spaces preserved in prompts and paths

## Deliberate limitations

- Command-hook definitions are registered in memory; a signed persistent hook-configuration loader is still needed.
- Mailbox messages are delivered on the next run for ordinary CLI adapters. Live mid-turn injection requires a runtime-specific control transport.
- The JSON Schema validator intentionally supports a bounded subset, not every draft feature.
- Large or unsupported untracked files may be omitted from checkpoints and mark them incomplete.
- OpenClaude control requests are normalized for visibility, but Damon does not yet answer OpenClaude's bidirectional control protocol directly.
