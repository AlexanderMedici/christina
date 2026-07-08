# Changelog

## 0.9.0 — Desktop Command Centre and Windows installer foundation

- Added the complete CHRISTINA desktop command centre.
- Added orchestration routing preview, live specialist status, confidence, synthesis, and run history.
- Added local-model provider/model management and in-app Ollama downloads.
- Added private library creation/scanning/removal through native folder selection.
- Added private tutor creation, teaching, quizzes, study guides, and citations.
- Added Approval Inbox and first-run setup screens.
- Added one-click NSIS packaging configuration and Windows installer CI workflow.
- Added a self-extracting Windows bootstrap installer for source-based alpha use.
- Updated user-facing CHRISTINA branding.

All notable CHRISTINA changes are documented here. Historical implementation details remain in `docs/CHANGES_*.md`.

## 0.8.0 — Private Libraries

- Added private, agent-scoped book libraries.
- Added local indexing and retrieval for PDF, EPUB, TXT, Markdown, HTML, JSON, and CSV.
- Added tutor, question-answering, quiz, and study-guide modes.
- Added external-drive availability tracking and index preservation.
- Added secure library removal without deleting source books.

## 0.7.0 — Local Models

- Added Ollama, LM Studio, and OpenAI-compatible local providers.
- Added model discovery, health checks, task scoring, streaming, and local synthesis.
- Added local-only, prefer-local, balanced, and cloud-first policies.

## 0.6.0 — Multi-Agent Orchestrator

- Added six specialist roles.
- Added decomposition, routing, dependency stages, aggregation, conflict precedence, synthesis, and confidence scoring.

## 0.4.0 — Agent Kernel Expansion

- Added lifecycle hooks, mailboxes, structured outputs, budgets, context compaction, runtime diagnostics, and reversible checkpoints.

## 0.3.0 — Host-Owned Agent Kernel

- Added normalized runtime adapters, durable sessions/runs/events, policies, reviewed memory, skills, tool gateway, and durable task graphs.
