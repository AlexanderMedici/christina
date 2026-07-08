# CHRISTINA vs Hermes Checklist

This checklist tracks the product gaps that matter most when comparing CHRISTINA to Hermes Agent, while separating features that already exist from features that still need implementation depth.

## Already in CHRISTINA

- [x] Local-first orchestration kernel
- [x] Specialist-agent routing with durable orchestration records
- [x] Durable sessions, runs, events, approvals, checkpoints, and task graphs
- [x] Reviewed memory and reusable skills
- [x] Local-model support through Ollama and LM Studio
- [x] Tool gateway with policy enforcement and approval flow
- [x] Private agent-scoped document libraries
- [x] Desktop command centre
- [x] Windows one-line bootstrap installer

## Implemented in this pass

- [x] Durable scheduler definitions in `packages/agent-kernel`
- [x] One-time and recurring interval schedules
- [x] Kernel dispatch for due schedules
- [x] Automatic memory recall for matching runs
- [x] Automatic active-skill recall for matching runs
- [x] Automatic draft-skill extraction from successful runs
- [x] Dependency-aware delegated task-graph dispatch
- [x] Scheduler CLI commands:
  `schedule:add`, `schedule:list`, `schedule:run-due`, `schedule:pause`, `schedule:resume`, `schedule:remove`
- [x] Task graph CLI commands:
  `tasks:create`, `tasks:list`, `tasks:run`

## Next high-value gaps

- [ ] Natural-language scheduling that compiles into schedule definitions
- [ ] Richer isolated subagent spawning with explicit merge-back summaries
- [ ] Automatic promotion of draft skills into reviewed active skills
- [ ] Stronger memory retrieval and personalization in orchestration synthesis
- [ ] Host-owned web search and browser automation through the tool gateway
- [ ] Docker and SSH execution backends
- [ ] Email and chat surfaces for notifications and remote interaction

## Suggested build order

1. Natural-language scheduling
2. Subagent execution and merge-back
3. Automatic skill extraction and stronger memory recall
4. Web tool gateway expansion
5. Docker and SSH backends
6. Messaging surfaces
