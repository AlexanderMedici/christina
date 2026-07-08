# CHRISTINA 0.7 — Local Model Runtime

CHRISTINA 0.7 adds first-class local inference. Local models are no longer routed through a terminal CLI or treated as plain text processes. They run through host-owned HTTP runtime adapters and emit the same durable events as Claude, Codex, OpenClaude, and other runtimes.

## Supported providers

### Ollama

Default endpoint:

```text
http://127.0.0.1:11434
```

CHRISTINA uses:

```text
GET  /api/tags
GET  /api/ps
POST /api/chat
```

The adapter supports streaming NDJSON, structured JSON/schema output, usage accounting, cancellation, model discovery, and structured tool-call events when the selected model returns them.

### LM Studio

Default endpoint:

```text
http://127.0.0.1:1234/v1
```

CHRISTINA uses the OpenAI-compatible endpoints:

```text
GET  /v1/models
POST /v1/chat/completions
```

The adapter supports SSE streaming, JSON-schema response formats, usage accounting, cancellation, and streamed tool-call assembly.

### Generic OpenAI-compatible local server

Set:

```text
CHRISTINA_LOCAL_OPENAI_BASE_URL=http://127.0.0.1:8080/v1
```

This works with local servers that implement at least:

```text
GET  /v1/models
POST /v1/chat/completions
```

Remote endpoints are rejected by default. To intentionally allow a non-localhost endpoint, set:

```text
CHRISTINA_ALLOW_REMOTE_MODEL_ENDPOINT=true
```

This opt-in exists because a remote endpoint changes the privacy and trust boundary.

## Immediate command-line use

After installing repository dependencies:

```bash
bun run local:models
```

This discovers all reachable local providers and models.

Run one prompt through the automatically selected local model:

```bash
bun run local:ask -- --prompt "Explain this repository architecture"
```

Select a provider and model explicitly:

```bash
bun run local:ask -- \
  --provider ollama \
  --model qwen2.5-coder:7b \
  --prompt "Review this TypeScript project"
```

Run a local-only CHRISTINA swarm:

```bash
bun run local:orchestrate -- \
  --prompt "Review this Node API, find bugs, and summarize the fixes" \
  --agents CODER,CRITIC,SUMMARIZER
```

## Local selection policies

`startChristina` accepts:

```text
local-only
prefer-local
balanced
cloud-first
```

### `local-only`

Every specialist and the final synthesis must use a local model. The orchestration fails clearly when no local model meets the minimum score.

### `prefer-local`

Default. CHRISTINA selects a suitable local model when one is available and falls back to the specialist's configured cloud runtime when no local model qualifies.

### `balanced`

A local model is used only when its score is at least 78. Otherwise CHRISTINA uses the configured cloud runtime.

### `cloud-first`

Preserves the earlier cloud/CLI-first behavior. Local models are used only as a fallback when a preferred runtime cannot be selected.

## Model scoring

Each discovered local model is scored from 0 to 100.

| Factor | Weight |
|---|---:|
| Specialist/task fit | 34% |
| Hardware fit | 20% |
| Context fit | 14% |
| Required capabilities | 14% |
| Efficiency | 12% |
| Already-loaded availability | 6% |

CHRISTINA considers:

- Specialist role
- Coding/reasoning/summarization hints in the model name and family
- Model size or parameter count
- Current free system memory
- Context-window information when the provider exposes it
- Structured-output requirements
- Tool-calling requirements
- Whether the model is already loaded
- Explicit provider or model preferences

The selector deliberately prefers the smallest model that is likely to complete the assigned task reliably. It does not automatically choose the largest installed model.

## Desktop API additions

The agent-kernel router now exposes:

```text
localModelProviders
localModels
selectLocalModel
```

`startChristina` also accepts:

```typescript
{
  localModelPolicy?: "local-only" | "prefer-local" | "balanced" | "cloud-first";
  localProviderIds?: string[];
  minimumLocalModelScore?: number;
}
```

The normal `start` endpoint accepts local runtime IDs such as:

```text
ollama
lmstudio
local-openai
```

and a model name in the existing `model` field.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CHRISTINA_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `CHRISTINA_LMSTUDIO_BASE_URL` | `http://127.0.0.1:1234/v1` | LM Studio OpenAI-compatible endpoint |
| `CHRISTINA_LMSTUDIO_API_KEY` | none | Optional LM Studio server token |
| `CHRISTINA_LOCAL_OPENAI_BASE_URL` | none | Generic local OpenAI-compatible endpoint |
| `CHRISTINA_LOCAL_OPENAI_API_KEY` | none | Optional generic endpoint token |
| `CHRISTINA_LOCAL_MODEL_TIMEOUT_MS` | `120000` | Request timeout |
| `CHRISTINA_ALLOW_REMOTE_MODEL_ENDPOINT` | `false` | Permit a non-localhost model endpoint |
| `CHRISTINA_HOME` | `~/.christina` for the CLI | Local kernel state directory |

## Current limits

- Hardware scoring currently uses free system RAM, provider-reported model size, parameter-size hints, and loaded state. Direct GPU/VRAM telemetry is not yet implemented.
- Capability detection is conservative and partly inferred from model metadata/name because providers do not always expose per-model tool and schema capability flags.
- OpenAI-compatible servers differ in their level of JSON-schema and tool-calling support. A server may advertise the endpoint while a particular model or prompt template does not reliably support every feature.
- The desktop settings screen for editing provider endpoints is still future UI work. Defaults and environment variables are fully functional now.

## Recommended next additions

1. GPU and VRAM discovery for NVIDIA, AMD, Apple Silicon, and Intel accelerators.
2. Persistent per-model success, correction, latency, and token-throughput history.
3. Model load/unload management for LM Studio and Ollama.
4. A desktop Local Models screen with endpoint editing and model assignment.
5. Automatic concurrency limits based on available memory.
