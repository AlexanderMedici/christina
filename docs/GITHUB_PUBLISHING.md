# GitHub Publishing Guide

## 1. Create the repository

Create a blank GitHub repository named `christina` without adding a README, license, or `.gitignore`.

## 2. Replace placeholders

Search the repository for:

```text
YOUR_GITHUB_USERNAME
```

Replace it with your GitHub user or organization name. Important files include:

- `package.json`
- `apps/desktop/package.json`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/workflows/desktop-build.yml`
- `README.md`
- `CONTRIBUTING.md`

## 3. Push the repository

```bash
git init
git add .
git commit -m "feat: initial CHRISTINA 0.8 source release"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/christina.git
git push -u origin main
```

## 4. Configure repository settings

Recommended settings:

- Enable Issues and Discussions.
- Enable private vulnerability reporting.
- Protect `main` and require the CI checks.
- Require pull-request reviews.
- Enable Dependabot alerts and security updates.
- Enable secret scanning and push protection when available.
- Disable Actions from untrusted forks from accessing repository secrets.

## 5. Desktop packaging metadata

The desktop builder reads:

```text
CHRISTINA_GITHUB_OWNER
CHRISTINA_GITHUB_REPO
```

Set these in Actions variables or the build environment. Unsigned desktop builds run through `.github/workflows/desktop-build.yml`.

## 6. Signing and notarization

Do not add certificates directly to the repository.

For macOS, store Apple signing and notarization credentials as encrypted Actions secrets. For Windows, use a trusted code-signing provider or certificate stored in encrypted secrets. Update the desktop release workflow only after validating unsigned builds.

## 7. Source releases

Create and push a version tag:

```bash
git tag v0.8.0
git push origin v0.8.0
```

The source-release workflow creates ZIP and TAR.GZ archives, SHA-256 checksums, and a GitHub Release.

## 8. License obligations

CHRISTINA remains subject to the Elastic License 2.0 inherited from the upstream derivative. Do not remove `LICENSE.md`, `NOTICE`, or `THIRD-PARTY-NOTICES.md`. Review the license before offering hosted or managed access.
