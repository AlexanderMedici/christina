# Damon ADE 0.3 Validation

Validation performed in the build environment:

## Passed

- Agent-kernel TypeScript source passed strict standalone type checking.
- Modified desktop integration files passed TypeScript syntax parsing.
- Biome 2.4.2 formatting and checks passed for all added and modified kernel files.
- Context budget selection was exercised.
- Workspace-boundary and publishing policy decisions were exercised.
- Proposed memory remained unavailable until explicitly approved.
- Durable session, run, event, memory, and task-graph storage was exercised.
- Dependency readiness and task unblocking were exercised.
- Tool scope denial was exercised before execution.
- A real child process was launched through the CLI runtime adapter.
- A prompt containing `&&` and a filesystem command remained literal process input and did not execute as shell syntax.
- The run completed with persisted normalized events.

## Not completed in this environment

A complete monorepo dependency installation and Electron build could not be completed because the package registry connection closed while Bun was resolving existing repository dependencies. The failure was network-related and affected numerous pre-existing packages, not only the new kernel package.

Before release, CI should run:

```bash
bun install --frozen-lockfile
bun run --cwd packages/agent-kernel typecheck
bun run --cwd packages/agent-kernel test
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop test
bun run build
```

CI should execute on:

- Windows x64
- macOS ARM64
- macOS x64

Native smoke tests should cover CLI discovery, `.cmd` wrappers, process-tree cancellation, spaces and Unicode in paths, application restart recovery, and installer packaging.
