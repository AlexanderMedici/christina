# Contributing to CHRISTINA

Thank you for helping improve CHRISTINA.

## Before starting

1. Search existing issues and pull requests.
2. Open an issue for substantial changes before implementation.
3. Do not include private books, extracted indexes, credentials, API keys, or personal application data.
4. Confirm that your contribution is compatible with the Elastic License 2.0 and existing third-party notices.

## Development setup

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/christina.git
cd christina
bun install
bun run dev:desktop
```

## Branches and commits

Use a focused branch such as:

```text
feat/local-embeddings
fix/windows-path-handling
docs/private-library-guide
```

Prefer conventional commit prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, or `chore`.

## Required checks

```bash
bun run lint
bun run typecheck
bun run test
```

For kernel changes:

```bash
bun run --cwd packages/agent-kernel typecheck
bun test packages/agent-kernel/src
```

Test cross-platform code on Windows and macOS where practical. Never construct commands by concatenating untrusted text into shell strings.

## Pull requests

A pull request should include:

- The problem being solved
- The approach and important trade-offs
- Tests performed
- Security/privacy implications
- Screenshots for visible UI changes
- Documentation updates where behavior changed

By submitting a contribution, you confirm that you have the right to provide it under this repository's license.

All contributors must follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
