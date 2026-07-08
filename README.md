<div align="center">

<img src="assets/christina.png" alt="CHRISTINA" width="340" />

# CHRISTINA

**Local-first multi-agent orchestration for private workflows, local models, and durable execution.**

[Desktop](#desktop-app) · [Quick Start](#quick-start) · [Local Models](#local-models) · [Private Libraries](#private-libraries) · [Monorepo](#monorepo) · [Documentation](#documentation)

</div>

CHRISTINA is a local-first orchestration system for running specialist AI agents across private and cloud-capable environments. It coordinates multi-step work, enforces policy at the kernel boundary, supports durable sessions and approvals, and gives selected agents controlled access to private knowledge libraries stored on local or external drives.

The repo includes the orchestration kernel, desktop app, web surfaces, local-model tooling, private library workflows, and the supporting packages that make the system runnable as a pnpm + Turbo monorepo.

> **Status:** Alpha. Core orchestration, desktop command centre, local model support, and private-library flows are implemented. Production signing and broader release hardening are still in progress.

## Why CHRISTINA

- **Local-first by default**: keep orchestration, indexes, and private knowledge close to the machine running the work
- **Multi-agent execution**: route tasks across specialist roles with dependency-aware orchestration
- **Policy-controlled tools**: approvals, execution rules, and storage boundaries are enforced in the kernel
- **Model-flexible runtime**: use local providers like Ollama and LM Studio, or cloud-capable integrations where allowed
- **Durable workflows**: sessions, task graphs, run events, and checkpoints are designed for long-running work
- **Private libraries**: assign scoped document collections to agents for tutoring, retrieval, and study workflows

## Core Capabilities

- Specialist roles including `RESEARCHER`, `CODER`, `FACT_CHECKER`, `SUMMARIZER`, `TOOL_EXECUTOR`, and `CRITIC`
- Durable sessions, approvals, memory, hooks, budgets, and task graphs
- Durable one-time and recurring schedules for unattended runs
- Automatic memory recall and skill recall during runs
- Automatic draft-skill extraction from successful runs
- Local model support via Ollama, LM Studio, and OpenAI-compatible local servers
- Routing modes for local-only, prefer-local, balanced, and cloud-first execution
- Agent-scoped libraries for PDF, EPUB, TXT, Markdown, HTML, JSON, and CSV content
- Desktop command execution on macOS and Windows with safer execution boundaries
- Electron desktop application for orchestration, models, approvals, and library management

## Quick Start

### Requirements

- Git
- Node.js `>=22`
- pnpm `>=10`
- A supported model runtime such as Ollama or LM Studio

### Clone and install

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/christina.git
cd christina
pnpm install
```

### Windows one-line install

PowerShell:

```powershell
irm https://raw.githubusercontent.com/AlexanderMedici/christina/main/installer/windows/install.ps1 | iex
```

The installer first tries the latest published Windows release. If none exists yet, it falls back to installing from the repository source and then runs CHRISTINA's existing Windows launcher.
When a release publishes `SHA256SUMS.txt`, the bootstrap script verifies the installer before launching it.

### Run the desktop app

```bash
pnpm dev:desktop
```

### Run the monorepo

```bash
pnpm dev
```

## Local Models

Start your local model runtime first, then use the included scripts:

```bash
pnpm local:models
pnpm profile:recommend
pnpm profile:init
pnpm doctor:runtime
pnpm local:ask -- --prompt "Explain this repository"
pnpm local:orchestrate -- --prompt "Review this API and summarize the main risks"
```

Default endpoints:

```text
Ollama:    http://127.0.0.1:11434
LM Studio: http://127.0.0.1:1234/v1
```

Recommended setup flow:

```bash
pnpm profile:recommend
pnpm profile:init
pnpm doctor:runtime
```

`profile:init` saves the preferred local provider/model to `CHRISTINA_HOME/local-profile.json`, and `local:ask` will use it automatically when you do not pass `--provider` or `--model`.

More details: [docs/LOCAL_MODELS_0.7.md](docs/LOCAL_MODELS_0.7.md)

## Scheduling

CHRISTINA now includes a durable scheduler foundation for unattended runs.

Create a one-time run:

```bash
pnpm schedule:add -- --agent LOCAL_ASSISTANT --runtime ollama --workspace local-cli --prompt "Summarize repo changes" --at 2026-07-09T13:00:00Z
```

Create a recurring run:

```bash
pnpm schedule:add -- --agent LOCAL_ASSISTANT --runtime ollama --workspace local-cli --prompt "Check project status" --every-minutes 60
```

Dispatch due schedules:

```bash
pnpm schedule:run-due
```

Checklist and roadmap: [docs/HERMES_GAP_CHECKLIST.md](docs/HERMES_GAP_CHECKLIST.md)

## Delegation

CHRISTINA can now execute dependency-aware task graphs as isolated delegated runs.

Create a task graph from JSON:

```bash
pnpm tasks:create -- --file tasks.json
```

Run a stored graph:

```bash
pnpm tasks:run -- --graph GRAPH_ID --workspace local-cli --runtime ollama --agent LOCAL_ASSISTANT
```

## Private Libraries

CHRISTINA can assign private local libraries to specific agent profiles.

Add a library:

```bash
pnpm books:add -- --name "Master Books" --path "/path/to/books"
```

Create an agent profile scoped to that library:

```bash
pnpm books:agent -- --name "MERN Tutor" --library LIBRARY_ID --provider ollama --model qwen2.5:7b
```

Ask questions against the assigned materials:

```bash
pnpm books:ask -- --agent PROFILE_ID --mode teach --question "Teach me data structures from my assigned books"
```

Access is enforced at the kernel boundary. Agents without an explicit library assignment cannot retrieve indexed passages from that collection.

More details: [docs/PRIVATE_BOOK_LIBRARIES_0.8.md](docs/PRIVATE_BOOK_LIBRARIES_0.8.md)

## Desktop App

The Electron desktop app acts as the main command centre for:

- orchestration runs
- model configuration
- approvals and execution control
- private-library management
- first-run setup and local workflows

Development:

```bash
pnpm dev:desktop
```

Package locally:

```bash
pnpm --filter @ade/desktop package -- --publish never
```

Windows installer details: [docs/WINDOWS_INSTALLER.md](docs/WINDOWS_INSTALLER.md)

## Monorepo

CHRISTINA is a pnpm + Turborepo monorepo.

```text
.
├── apps/          admin, api, desktop, docs, marketing, mobile, streams, web
├── packages/      agent, agent-kernel, auth, chat, db, local-db, mcp, trpc, ui
├── scripts/       local tooling, release scripts, and repository automation
├── docs/          architecture, validation, publishing, and product guides
├── tooling/       shared TypeScript and build configuration
└── assets/        repository assets
```

Full structure: [docs/REPOSITORY_STRUCTURE.md](docs/REPOSITORY_STRUCTURE.md)

## Common Commands

```bash
# Development
pnpm dev
pnpm dev:desktop

# Quality
pnpm lint
pnpm typecheck
pnpm build

# Formatting
pnpm format
pnpm lint:fix
```

Some workspace tests still use Bun's test runner and have not been migrated yet.

## GitHub Setup

If you are publishing this fork under your own account, create the first commit before pushing:

```bash
git init
git add .
git commit -m "feat: initial CHRISTINA source release"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/christina.git
git push -u origin main
```

Then update placeholder repository metadata in `package.json` and related files.

Publishing notes: [docs/GITHUB_PUBLISHING.md](docs/GITHUB_PUBLISHING.md)

## Security and Privacy

- Private indexes remain local unless you explicitly change execution policy
- Remote local-model endpoints are blocked by default
- Destructive or external actions must pass policy evaluation and may require approval
- Do not commit `.env` files, credentials, model secrets, or private index data

Security policy: [SECURITY.md](SECURITY.md)

## Documentation

- [CHRISTINA orchestrator](docs/CHRISTINA_ORCHESTRATOR_0.6.md)
- [Agent kernel](docs/AGENT_KERNEL_0.4_OPENCLAUDE.md)
- [Desktop UI](docs/DESKTOP_UI_0.9.md)
- [Local models](docs/LOCAL_MODELS_0.7.md)
- [Private book libraries](docs/PRIVATE_BOOK_LIBRARIES_0.8.md)
- [Windows installer](docs/WINDOWS_INSTALLER.md)
- [GitHub publishing](docs/GITHUB_PUBLISHING.md)
- [Repository structure](docs/REPOSITORY_STRUCTURE.md)
- [Roadmap](ROADMAP.md)

## License

This repository is a modified derivative distributed under the **Elastic License 2.0**.

Review [LICENSE.md](LICENSE.md), [NOTICE](NOTICE), and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) before redistribution or commercial deployment.
