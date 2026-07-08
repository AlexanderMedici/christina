# Damon ADE 0.3 Changes

## Added

- New `@superset/agent-kernel` workspace package.
- Host-owned durable agent sessions and run records.
- Normalized runtime event contract.
- Generic cross-platform CLI runtime adapter.
- Runtime health checks and cancellation.
- Context prioritization and token budgeting.
- Workspace policy engine and durable approval records.
- Reviewed factual, episodic, and procedural memory records.
- Versioned skill registry with selection and outcome tracking.
- Host-owned tool gateway with scopes, policy checks, approvals, timeouts, and output limits.
- Durable dependency graphs for multi-agent task orchestration.
- Restart recovery for interrupted runs.
- Desktop `agentKernel` tRPC router.
- Automated tests for context, policy, storage, memory, and kernel execution.

## Changed

- Desktop version raised to `0.3.0`.
- Desktop now depends on `@superset/agent-kernel`.
- Bun workspace lock includes the new package.
- README documents the kernel architecture and compatibility mode.

## Compatibility

- Existing interactive terminal sessions remain unchanged.
- Existing agent memory Markdown files remain intact.
- The new kernel stores its records in `<ADE_HOME_DIR>/agent-kernel`.
- macOS, Windows executables, and Windows npm `.cmd` shims are supported by the runtime process layer.

## Known limitations

- Third-party CLI internals are not yet parsed into structured tool events.
- The policy engine cannot intercept tools executed entirely inside an opaque third-party CLI.
- The Run Timeline and Approval Inbox UI are not yet implemented.
- Docker, WSL, SSH, semantic embeddings, compaction, automatic task dispatch, and replay remain future phases.
