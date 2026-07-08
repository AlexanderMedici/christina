# Changes in CHRISTINA 0.6

## Added

- CHRISTINA identity and product branding
- Six specialist-agent profiles
- Deterministic routing matrix
- Maximum of six unique specialist responses
- Explicit agent, runtime, and model overrides
- Dependency-aware parallel specialist stages
- Durable orchestration records
- Structured specialist output contract
- Fact-checker and critic conflict precedence
- Orchestrator synthesis run
- Deterministic fallback synthesis
- Confidence score with five-component breakdown
- Final response assembly with collapsed routing log and appended confidence
- Automatic clarification warning below 70% confidence
- Tool-executor call schema with a hard 30-second timeout ceiling
- Collapsed routing-log renderer
- Orchestration cancellation
- Run-wait API for host-owned sequencing
- Restart recovery for interrupted orchestrations
- `CHRISTINA_RUN_ID` and `CHRISTINA_SESSION_ID`
- Desktop tRPC orchestration endpoints
- Integrated orchestration tests

## Changed

- Active kernel-facing Damon labels were renamed to CHRISTINA.
- Desktop product name is now CHRISTINA while internal workspace package identifiers remain compatible.
- Agent-kernel package version is now 0.6.0.
- Downstream verification stages run after upstream tasks settle, even when an upstream task fails.

## Compatibility

- Existing runtime adapters and terminal sessions remain available.
- Existing `ADE_RUN_ID` and `ADE_SESSION_ID` values are still emitted.
- Existing kernel stores gain a new `orchestrations` directory without migrating other records.
