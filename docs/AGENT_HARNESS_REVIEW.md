# ADE Agent Harness Review and Portable 0.2 Proposal

## Executive assessment

The original 0.1 harness has a strong persistent-agent concept, but its execution layer is tightly coupled to Unix shells and defaults to maximum permissions. That creates three practical problems: native Windows commands fail, prompts are assembled as shell strings, and a normal click launches an agent with destructive access.

## Changes implemented in 0.2

### 1. Safe-by-default operating modes

- `review`: analysis only; no modifications until approval.
- `workspace` (default): autonomous repository work with approval for destructive, external, credential, or out-of-workspace actions.
- `unrestricted`: the previous danger mode, now explicit and opt-in.

### 2. Portable runtime registry

Runtime executable, arguments, environment, and safety flags now come from one typed registry. This removes duplicated command strings across model presets, task launches, and settings.

### 3. Shell-injection-resistant prompt transport

The old Unix heredoc command builder was replaced with a portable Node launcher. Prompt text is UTF-8/base64 encoded into a structured launch payload and passed as an argument array instead of concatenated directly into a shell command.

### 4. macOS and Windows terminal behavior

- PowerShell, pwsh, and cmd receive valid startup and `-Command`/`/c` arguments.
- Windows paths with backslashes are recognized correctly.
- Windows uses installed agent CLIs directly. Unix-only notification wrappers are skipped rather than breaking startup.

### 5. Cross-platform repository scripts

Lint, postinstall, and canary release wrappers are now Bun/TypeScript scripts instead of Bash-only entry points.

### 6. Cross-platform installation guidance

The install dialog can show platform-specific Git commands. Runtime-to-binary mappings for Copilot and Cursor are corrected rather than incorrectly testing for Codex.

### 7. Desktop packaging

- macOS builds target Apple Silicon and Intel.
- Windows x64 NSIS builds and update manifests are produced in GitHub Actions.
- Electron Builder no longer hardcodes a single architecture in the shared config.

## Remaining recommended work

1. Replace Unix notification wrappers with a small Node hook executable so completion notifications work identically on Windows.
2. Add Windows integration tests on a real runner for node-pty, better-sqlite3, worktree creation, and each supported CLI.
3. Move long prompts from command-line payloads to securely permissioned temporary files to avoid Windows command-length limits.
4. Split cloud/web/mobile packages from the desktop harness build graph to reduce installation and CI time.
5. Add a UI selector for `review`, `workspace`, and `unrestricted` modes with a warning confirmation for unrestricted mode.
6. Add per-agent concurrency, token, cost, and wall-clock budgets.
7. Add a structured run ledger containing plan, commands, changed files, test evidence, and final status for every session.

## Compatibility target

- macOS 13+ on arm64 and x64
- Windows 10/11 x64 using PowerShell or cmd
- Node.js available for the portable launcher
- Bun used for source development and packaging
