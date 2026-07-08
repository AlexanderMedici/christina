# CHRISTINA Desktop UI 0.9

CHRISTINA 0.9 adds a complete desktop command centre to the existing Electron shell.

## Command Centre

The `CHRISTINA` item in the left sidebar opens the command centre. The root route now opens this screen by default.

### Orchestrator

- Enter a request and working folder.
- Choose local-only, prefer-local, balanced, or cloud-first routing.
- Choose review, workspace, or unrestricted safety mode.
- Let CHRISTINA select specialists automatically or select up to six manually.
- Preview the route before execution.
- Watch specialist status, runtime/model assignment, progress, confidence, and the final synthesis.
- Cancel an active run and reopen recent orchestrations.

### Local Models

- Inspect Ollama, LM Studio, and OpenAI-compatible local endpoints.
- Discover available and loaded models.
- Download an Ollama model without using PowerShell.
- Refresh provider and model health.

### Private Libraries

- Select a local or external-drive folder through the native directory picker.
- Create, scan, refresh, and remove a private book index.
- View source availability and indexing status.
- Original files are never modified by index removal.

### Tutors

- Create a local knowledge agent.
- Assign one or more private libraries.
- Choose a local model and teaching style.
- Ask questions, request step-by-step teaching, generate quizzes, and create study guides.
- View book citations returned by the private retrieval layer.

### Approvals

- Review sensitive host actions.
- Inspect the requesting agent, target, command, reason, and risk level.
- Approve once or deny.

### Setup

- First-run readiness checklist.
- Local provider and model status.
- Private library and tutor status.
- Runtime health.
- Direct links to Ollama and LM Studio installers.

## Files added

```text
apps/desktop/src/renderer/screens/christina/ChristinaStudio.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/christina/page.tsx
.github/workflows/windows-installer.yml
```

## Files integrated

- Desktop sidebar navigation
- Root-route redirect
- Agent-kernel tRPC router
- Electron Builder/NSIS configuration
- User-facing CHRISTINA branding

## Validation boundary

The new TypeScript and TSX files pass source-level TypeScript parsing. A complete Electron production build requires downloading the monorepo dependencies and Electron platform binaries on Windows or through the included GitHub Actions workflow.
