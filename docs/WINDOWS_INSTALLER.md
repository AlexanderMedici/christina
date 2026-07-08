# Windows installation

CHRISTINA provides two Windows installation paths.

## 1. Bootstrap installer

`CHRISTINA-0.9.0-Windows-Bootstrap-Installer.exe` is a clickable, unsigned installer that:

1. Installs the complete CHRISTINA repository under `%LOCALAPPDATA%\Programs\CHRISTINA`.
2. Creates Desktop and Start Menu shortcuts.
3. Adds a local uninstaller entry.
4. Starts a guided launcher.
5. On first launch, installs missing development prerequisites through Windows Package Manager when available.
6. Installs the Bun workspace dependencies.
7. Opens the Electron desktop application.

An internet connection is required on the first launch to install missing prerequisites and JavaScript/Electron dependencies. Windows SmartScreen may warn because this development installer is not code-signed.

## 2. Production NSIS installer

The repository includes `.github/workflows/windows-installer.yml`. Run this workflow on a Windows GitHub Actions runner to create the packaged Electron/NSIS installer.

The production workflow:

- installs the pinned Bun version;
- installs the lockfile dependencies;
- generates routes and type-checks the desktop app;
- builds the Windows x64 application;
- creates an NSIS `.exe` installer;
- uploads the installer and SHA-256 checksum as workflow artifacts;
- attaches release files when triggered by a version tag.

A signed public release additionally requires a Windows code-signing certificate and repository secrets.

## Installed data

Application source and runtime files are installed under:

```text
%LOCALAPPDATA%\Programs\CHRISTINA
```

CHRISTINA user data, private indexes, and settings are stored outside the installation folder. Upgrading or uninstalling the application should not remove original book files.
