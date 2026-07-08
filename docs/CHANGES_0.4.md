# Changes in Damon ADE 0.4

## Added

- First-class `openclaude` runtime in shared runtime definitions, installation checks, local database schema, new-agent selector, and model bar.
- Structured `OpenClaudeRuntimeAdapter` with NDJSON parsing and native session resume.
- `runtime.session` normalized event and durable runtime-session mapping.
- Host lifecycle-hook engine with callback and portable command hooks.
- Session mailbox with claim, delivery, recovery, cancellation, and pinned-context injection.
- Deterministic context micro-compaction and compaction audit records.
- Run budgets for duration, turns, cost, tokens, tool calls, and output size.
- JSON output contracts and bounded JSON Schema validation.
- Git-backed checkpoint creation and restore with approval enforcement.
- Runtime doctor and capability scoring.
- Host-owned tool hook stages and policy-aware transformations.
- Desktop tRPC endpoints for hooks, mailbox, checkpoints, budgets, output contracts, and diagnostics.
- OpenClaude parser, hook, and structured-output tests.

## Changed

- Runtime events now share one host-owned sequence after resequencing.
- The kernel automatically resumes runtimes that have a stored native session ID.
- OpenClaude receives native max-turn, max-cost, and JSON-schema arguments where available.
- Interrupted mailbox claims are returned to the queue during startup recovery.
- `checkpoint.restore` is a high-impact policy category requiring approval.
- Agent-kernel package version advanced to `0.4.0`.

## Safety

- Prompt strings remain process arguments, never shell fragments.
- Command hooks use JSON over stdin/stdout and run with `shell: false`.
- Checkpoint restore requires both an approved authorization record and explicit force inside the service.
- Paths restored from checkpoints are checked to remain inside the workspace.
- Unrestricted OpenClaude mode remains explicitly opt-in.
