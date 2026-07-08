$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'CHRISTINA Setup and Launcher'

$InstallRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogRoot = Join-Path $env:LOCALAPPDATA 'CHRISTINA\logs'
$LogFile = Join-Path $LogRoot 'launcher.log'
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
Start-Transcript -Path $LogFile -Append | Out-Null

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Require-Winget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'Windows Package Manager (winget) is required to install missing prerequisites. Install App Installer from Microsoft Store, then run CHRISTINA again.'
    }
}

try {
    Write-Host 'CHRISTINA — Composable Harness Reactive Intelligent Systems Tool Integration Neural Agents' -ForegroundColor Magenta
    Write-Host "Installation: $InstallRoot"

    Refresh-Path

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Step 'Installing Git for Windows'
        Require-Winget
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
    }

    $nodeOk = $false
    if (Get-Command node -ErrorAction SilentlyContinue) {
        try {
            $major = [int]((node --version).TrimStart('v').Split('.')[0])
            $nodeOk = $major -ge 22
        } catch { $nodeOk = $false }
    }
    if (-not $nodeOk) {
        Write-Step 'Installing Node.js LTS'
        Require-Winget
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
    }

    if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
        throw 'Corepack is required to activate pnpm. Restart Windows after Node.js installs and launch CHRISTINA again.'
    }

    Write-Step 'Activating pnpm via Corepack'
    corepack enable
    if ($LASTEXITCODE -ne 0) { throw "corepack enable failed with exit code $LASTEXITCODE." }
    corepack prepare pnpm@10.0.0 --activate
    if ($LASTEXITCODE -ne 0) { throw "corepack prepare pnpm failed with exit code $LASTEXITCODE." }
    Refresh-Path

    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw 'pnpm activation did not complete. Restart Windows and launch CHRISTINA again.'
    }

    Set-Location $InstallRoot
    $Marker = Join-Path $InstallRoot 'node_modules\.christina-installed'
    if (-not (Test-Path $Marker)) {
        Write-Step 'Installing CHRISTINA application dependencies (first launch only)'
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE." }
        New-Item -ItemType File -Force -Path $Marker | Out-Null
    }

    Write-Step 'Starting CHRISTINA Desktop'
    Write-Host 'You can close this launcher window after the desktop application opens.' -ForegroundColor DarkGray
    pnpm dev:desktop
    if ($LASTEXITCODE -ne 0) { throw "CHRISTINA exited with code $LASTEXITCODE." }
}
catch {
    Write-Host "`nCHRISTINA could not start:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "`nLog file: $LogFile" -ForegroundColor Yellow
    Read-Host 'Press Enter to close'
    exit 1
}
finally {
    try { Stop-Transcript | Out-Null } catch {}
}
