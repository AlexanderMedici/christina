# CHRISTINA 0.7 changes

## Local provider layer

- Added `LocalModelProvider` and `LocalModelService`.
- Added first-class Ollama runtime support.
- Added LM Studio support through its OpenAI-compatible server.
- Added configurable generic OpenAI-compatible local endpoints.
- Enforced localhost-only endpoints by default.

## Runtime execution

- Added streaming Ollama NDJSON parsing.
- Added streaming OpenAI-compatible SSE parsing.
- Added local request cancellation and timeouts.
- Added local token and duration usage events.
- Added Ollama tool-call events.
- Added streamed OpenAI-compatible tool-call assembly.
- Added structured JSON and JSON-schema output requests.

## Discovery and selection

- Added model discovery and provider health inspection.
- Added loaded-model discovery for Ollama.
- Added hardware-aware model scoring.
- Added specialist/task suitability scoring.
- Added context, capability, efficiency, and availability scoring.
- Added explicit provider/model preference handling.

## Orchestration

- Added `local-only`, `prefer-local`, `balanced`, and `cloud-first` policies.
- `prefer-local` is the new orchestration default.
- Specialists can be assigned different local models automatically.
- Final synthesis can run locally.
- Contributions now record runtime ID, model name, and local selection score.

## Desktop API

- Runtime IDs in the agent-kernel router are now extensible strings rather than a fixed cloud CLI enum.
- Added `localModelProviders`.
- Added `localModels`.
- Added `selectLocalModel`.
- Added local policy and provider filters to `startChristina`.

## Developer CLI

Added:

```text
bun run local:models
bun run local:ask
bun run local:orchestrate
```

## Package

- Agent-kernel package version updated to 0.7.0.
