# CHRISTINA 0.6 — Multi-Agent Orchestrator

**CHRISTINA** stands for **Composable Harness Reactive Intelligent Systems Tool Integration Neural Agents**.

Version 0.6 adds the orchestration layer above the host-owned agent kernel. CHRISTINA now decomposes requests, assigns work to specialist roles, executes dependency stages in parallel, collects durable contributions, applies conflict precedence, synthesizes a final answer, and calculates a transparent confidence score.

## Specialist roster

| Agent | Purpose | Preferred runtime | Preferred model label |
|---|---|---|---|
| `RESEARCHER` | Deep research, long-form analysis, citations | OpenClaude | Claude 3.7 Sonnet |
| `CODER` | Implementation, debugging, refactoring | Codex | GPT-5.5 / Codex |
| `FACT_CHECKER` | Claim verification and hallucination detection | Gemini | Gemini 2.0 Pro |
| `SUMMARIZER` | Condensation and executive summaries | OpenCode | Llama 3 70B-class |
| `TOOL_EXECUTOR` | APIs, databases, files, calculations, automation | OpenCode | GPT-4o-class tool model |
| `CRITIC` | Security, quality, edge cases, adversarial review | Claude | Claude 3.5 Haiku-class |

Runtime and model mappings are defaults, not hard dependencies. Every role can be overridden per orchestration.

## Routing

The deterministic router detects the domains represented in the request and selects only useful specialists. Explicit agent selection is also supported.

Rules include:

- Code, debugging, implementation, scripts, or algorithms → `CODER`
- Research, sources, citations, literature, or technical documentation → `RESEARCHER`
- Verification, cross-referencing, or fact-checking → `FACT_CHECKER`
- Summaries, shortening, or condensation → `SUMMARIZER`
- API/database queries, calculation, retrieval, files, or email → `TOOL_EXECUTOR`
- Reviews, audits, risks, security, gaps, or edge cases → `CRITIC`

At most **six unique specialist responses** are created for one orchestration.

## Dependency stages

CHRISTINA uses dependencies for ordering, not for suppressing downstream review after an upstream failure.

Typical execution:

```text
Stage 1 — parallel
RESEARCHER   CODER   TOOL_EXECUTOR
       \       |       /
Stage 2 — parallel after Stage 1 settles
FACT_CHECKER   CRITIC
          \     /
Stage 3
SUMMARIZER
    |
Stage 4
ORCHESTRATOR synthesis
```

A specialist whose dependency failed still receives the available outputs and can report the missing evidence. This preserves the rule that synthesis waits until every routed specialist has responded or definitively failed.

## Structured specialist contract

Each specialist is asked to return JSON containing:

- `summary`
- `content`
- `confidence` from 0–100
- `claims` with verification status
- `caveats`
- `sources` with authority and publication date
- optional severity-ranked issues

The kernel validates the result independently of the model runtime.

## Conflict resolution

Synthesis uses this precedence:

1. `FACT_CHECKER` controls factual determinations.
2. `CRITIC` controls serious security and quality objections.
3. The original user request is the final tiebreaker.

The synthesis prompt explicitly prevents invented tool results or unsupported facts.

## Confidence score

The score is stored with a breakdown:

| Component | Maximum |
|---|---:|
| Specialist completion | 25 |
| Agent consensus/confidence | 25 |
| Fact-check verification | 25 |
| Source recency and authority | 15 |
| Critic quality/security status | 10 |
| **Total** | **100** |

When the score is below 70, `needsClarification` is set and the final synthesis is instructed to state what is missing.

## Durable records

Each orchestration is written to:

```text
<CHRISTINA_HOME>/agent-kernel/orchestrations/<id>.json
```

It contains:

- Original request
- Route plan and dependency graph
- Collapsed routing log
- Specialist statuses and run IDs
- Structured outputs and sources
- Synthesis run and final synthesis
- Confidence breakdown
- Failure or cancellation state

A host restart marks an unfinished orchestration as failed instead of leaving it permanently running.

## Desktop API

The `agentKernel` tRPC router now exposes:

```text
routeChristina
startChristina
orchestrations
orchestration
cancelChristina
```

Existing run, approval, memory, skill, tool, task-graph, mailbox, and checkpoint endpoints remain available.

## Tool-executor contract

`TOOL_EXECUTOR` must identify:

- Tool name
- JSON parameters
- Expected return schema
- Timeout of 30 seconds or less

Recognized names:

```text
web_search
database_query
calculator
file_reader
api_caller
email_sender
```

The prompt forbids claiming that a tool succeeded unless a real tool result exists. Host tools still pass through the kernel tool gateway, policy engine, scopes, timeouts, approvals, and audit logging.

## Cross-platform behavior

The orchestration layer uses the existing portable runtime boundary:

- Argument arrays rather than interpolated shell commands
- `shell: false`
- Windows process-tree cancellation
- macOS/Linux signal cancellation
- Unicode and space-safe paths
- Runtime and model overrides independent of the operating system

Legacy `ADE_*` environment variables remain for compatibility; new launches also receive `CHRISTINA_RUN_ID` and `CHRISTINA_SESSION_ID`.
