# Security Policy

## Supported versions

CHRISTINA is currently an alpha project. Security fixes are applied to the latest source on the `main` branch.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving credential exposure, arbitrary command execution, sandbox escape, library-access bypass, path traversal, or remote code execution.

Use GitHub private vulnerability reporting after enabling it in **Settings → Security → Private vulnerability reporting**. Until that is enabled, contact the repository owner privately through their verified GitHub profile.

Include:

- Affected commit or version
- Operating system
- Reproduction steps
- Expected and actual behavior
- Impact
- Suggested remediation, when available

## Security boundaries

CHRISTINA treats the following as privileged operations:

- Credential access
- External messaging or email
- Git push and package publication
- Destructive file operations
- Checkpoint restoration
- Network access by private-library agents

Private-library authorization must be enforced by the host kernel, not merely by prompts. Never weaken access checks to improve convenience.

## Secrets

Never commit:

- `.env` or `.env.*` files
- API keys or access tokens
- Local application-data folders
- Extracted book indexes
- User conversations or session transcripts
- Signing certificates
