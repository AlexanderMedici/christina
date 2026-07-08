# Damon ADE 0.4 Validation

## Completed successfully

### Static validation

- Agent-kernel strict TypeScript compilation passed.
- Shared runtime-command and binary-registry TypeScript compilation passed.
- Desktop kernel integration and tRPC router passed TypeScript syntax transpilation.

### Integrated kernel execution

A compiled Node validation harness exercised:

- Durable session and run storage
- Host `run.before` hook transformation
- Context micro-compaction
- Structured JSON validation
- Turn and cost budget tracking
- Native runtime-session persistence
- Session mailbox claim and delivery
- Runtime diagnostics
- Git checkpoint creation and restoration

Observed normalized event sequence:

```text
context.compacted
run.started
runtime.session
assistant.delta
usage.updated
budget.updated
turn.completed
budget.updated
output.validated
run.completed
```

### OpenClaude adapter validation

A fake executable was launched through the real `OpenClaudeRuntimeAdapter`. Validation confirmed:

- Structured NDJSON records were normalized correctly.
- `--max-turns`, `--max-budget-usd`, and `--json-schema` were included.
- A prompt containing `&& touch ...` remained one literal final argument.
- The shell operator did not execute and no marker file was created.
- The resulting events were:

```text
run.started
runtime.session
assistant.delta
usage.updated
turn.completed
run.completed
```

### Checkpoint validation

A temporary Git repository was created, modified, checkpointed, modified again, and restored. Both tracked changes and a bounded untracked file were recovered to the checkpoint state.

## Not completed in this environment

- Full Bun monorepo installation and Electron packaging were not run because repository dependencies were not installed in the execution environment.
- A real authenticated OpenClaude API session was not executed. The adapter was tested against the uploaded source's stream formats and a process-level structured fixture.
- Native Windows execution was not available. Windows behavior is implemented through the already-tested cross-platform process abstraction and should be confirmed by CI on a Windows runner.

## Recommended CI matrix

- Windows x64: typecheck, unit tests, fake-runtime adapter test, Electron compile, NSIS packaging.
- macOS ARM64: typecheck, tests, Electron compile, DMG packaging.
- macOS x64: typecheck, tests, Electron compile, DMG packaging.
- Optional authenticated smoke test for OpenClaude using a restricted test workspace and a cost ceiling.
