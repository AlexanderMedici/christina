<div align="center">

<img src="assets/christina.png" alt="CHRISTINA — multi-agent orchestration system" width="360" />

# CHRISTINA

### **C**omposable **H**arness **R**eactive **I**ntelligent **S**ystems **T**ool **I**ntegration **N**eural **A**gents

*Local-first multi-agent orchestration, private knowledge libraries, and intelligent model routing.*

</div>

CHRISTINA is a local-first, cross-platform multi-agent orchestration system. It routes work to specialist agents, supports cloud and local model runtimes, coordinates dependent tasks, enforces host-owned policies, and can give selected agents private access to book collections stored on local or external drives.

> **Project status:** Alpha desktop release. The orchestration kernel, local-model providers, private-library services, and CHRISTINA Command Centre UI are implemented. The included bootstrap installer is unsigned; signed production installers remain a release-engineering step.

## Core capabilities

- Six specialist roles: `RESEARCHER`, `CODER`, `FACT_CHECKER`, `SUMMARIZER`, `TOOL_EXECUTOR`, and `CRITIC`
- Durable sessions, run events, approvals, task graphs, memory, skills, budgets, hooks, and Git checkpoints
- Local models through Ollama, LM Studio, and OpenAI-compatible local servers
- Local-only, prefer-local, balanced, and cloud-first routing policies
- Private agent-scoped libraries for PDF, EPUB, TXT, Markdown, HTML, JSON, and CSV files
- Local tutoring, book Q&A, quizzes, and study-guide generation with passage citations
- Native macOS and Windows command execution without unsafe shell interpolation
- Complete CHRISTINA Command Centre for orchestration, local models, private libraries, tutors, approvals, and first-run setup
- Electron desktop application and TypeScript/Bun monorepo

## Repository layout

```text
.
├── apps/                 Desktop, API, web, docs, marketing, mobile, streams
├── packages/             Agent kernel, shared libraries, database, UI, MCP
├── scripts/              Cross-platform release, local-model, and book tools
├── tooling/              Shared TypeScript and build configuration
├── docs/                 Architecture, validation, changes, and user guides
├── .github/              CI, security scanning, issue forms, and releases
├── LICENSE.md            Elastic License 2.0 inherited from upstream
├── NOTICE                Derivative-work and attribution notice
└── THIRD-PARTY-NOTICES.md
```

A complete generated tree is available in [`docs/REPOSITORY_STRUCTURE.md`](docs/REPOSITORY_STRUCTURE.md).

## Requirements

- Git
- Node.js 22 or newer
- Bun 1.3.6 or newer
- One supported model runtime, such as Ollama, LM Studio, Claude Code, Codex, OpenClaude, or OpenCode

## Windows installer

A clickable bootstrap installer and a GitHub Actions NSIS production-build workflow are included. See [`docs/WINDOWS_INSTALLER.md`](docs/WINDOWS_INSTALLER.md).

## Clone and run

Replace `YOUR_GITHUB_USERNAME` after creating your repository:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/christina.git
cd christina
bun install
bun run dev:desktop
```

### Windows PowerShell

```powershell
git clone https://github.com/YOUR_GITHUB_USERNAME/christina.git
Set-Location christina
bun install
bun run dev:desktop
```

## Local models

Start Ollama or the LM Studio local server, then run:

```bash
bun run local:models
bun run local:ask -- --prompt "Explain this repository"
bun run local:orchestrate -- --prompt "Review this API and summarize the risks"
```

Default local endpoints:

```text
Ollama:    http://127.0.0.1:11434
LM Studio: http://127.0.0.1:1234/v1
```

See [`docs/LOCAL_MODELS_0.7.md`](docs/LOCAL_MODELS_0.7.md).

## Private book libraries

Point CHRISTINA at a local folder, external drive, or mounted volume:

```powershell
bun run books:add -- --name "Master Books" --path "E:\Books"
```

```bash
bun run books:add -- --name "Master Books" --path "/Volumes/BookDrive/Books"
```

Create a private local tutor using the returned library ID:

```bash
bun run books:agent -- --name "MERN Tutor" --library LIBRARY_ID --provider ollama --model qwen2.5:7b
bun run books:ask -- --agent PROFILE_ID --mode teach --question "Teach me data structures from my assigned books"
```

Library access is checked at the kernel boundary. Agents without an explicit assignment cannot retrieve the indexed passages.

See [`docs/PRIVATE_BOOK_LIBRARIES_0.8.md`](docs/PRIVATE_BOOK_LIBRARIES_0.8.md).

## Quality checks

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Targeted agent-kernel checks:

```bash
bun run --cwd packages/agent-kernel typecheck
bun test packages/agent-kernel/src
```

## Build the desktop application

```bash
bun run --cwd apps/desktop compile:app
bunx electron apps/desktop
```

Unsigned local package:

```bash
bun run --cwd apps/desktop package -- --publish never
```

Signed distribution requires platform-specific certificates and repository secrets. See [`docs/GITHUB_PUBLISHING.md`](docs/GITHUB_PUBLISHING.md).

## GitHub setup

After creating a blank repository:

```bash
git init
git add .
git commit -m "feat: initial CHRISTINA 0.8 source release"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/christina.git
git push -u origin main
```

Then replace `YOUR_GITHUB_USERNAME` in repository metadata and configure the optional Actions variables described in [`docs/GITHUB_PUBLISHING.md`](docs/GITHUB_PUBLISHING.md).

## Security and privacy

- Private book indexes remain local unless you explicitly change the execution policy.
- Remote local-model endpoints are blocked by default.
- Destructive actions, publishing, credential access, and external messaging require policy evaluation and may require approval.
- Never commit `.env` files, API keys, model credentials, private book indexes, or application data.

Report vulnerabilities according to [`SECURITY.md`](SECURITY.md).

## Documentation

- [CHRISTINA orchestrator](docs/CHRISTINA_ORCHESTRATOR_0.6.md)
- [Local models](docs/LOCAL_MODELS_0.7.md)
- [Private book libraries](docs/PRIVATE_BOOK_LIBRARIES_0.8.md)
- [Desktop Command Centre](docs/DESKTOP_UI_0.9.md)
- [Windows installer](docs/WINDOWS_INSTALLER.md)
- [Agent kernel](docs/AGENT_KERNEL_0.4_OPENCLAUDE.md)
- [GitHub publishing](docs/GITHUB_PUBLISHING.md)
- [Roadmap](ROADMAP.md)

## License and attribution

This repository is a modified derivative distributed under the **Elastic License 2.0**. Review [`LICENSE.md`](LICENSE.md), [`NOTICE`](NOTICE), and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) before redistribution or commercial deployment.
