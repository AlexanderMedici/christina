param(
    [string]$Owner = "AlexanderMedici",
    [string]$Repo = "christina",
    [string]$Ref = "main",
    [string]$InstallRoot = "$env:LOCALAPPDATA\Programs\CHRISTINA",
    [ValidateSet("auto", "release", "source")]
    [string]$Channel = "auto"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-GitHubJson([string]$Url) {
    return Invoke-RestMethod -Headers @{
        "Accept" = "application/vnd.github+json"
        "User-Agent" = "CHRISTINA-Installer"
    } -Uri $Url
}

function Download-File([string]$Url, [string]$Destination) {
    Invoke-WebRequest -Headers @{
        "User-Agent" = "CHRISTINA-Installer"
    } -Uri $Url -OutFile $Destination
}

function Get-SourceArchiveUrl([string]$SourceOwner, [string]$SourceRepo, [string]$SourceRef) {
    if ($SourceRef -match "^v\d") {
        return "https://github.com/$SourceOwner/$SourceRepo/archive/refs/tags/$SourceRef.zip"
    }

    return "https://github.com/$SourceOwner/$SourceRepo/archive/refs/heads/$SourceRef.zip"
}

function Get-LatestReleaseAssets {
    param(
        [string]$ReleaseOwner,
        [string]$ReleaseRepo
    )

    try {
        $release = Invoke-GitHubJson "https://api.github.com/repos/$ReleaseOwner/$ReleaseRepo/releases/latest"
    } catch {
        return $null
    }

    if (-not $release.assets) {
        return $null
    }

    return @($release.assets)
}

function Get-ReleaseInstallerAsset {
    param(
        [object[]]$Assets
    )

    $candidates = @($Assets | Where-Object {
        $_.name -match "^CHRISTINA-\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?-(x64|arm64)\.exe$"
    })

    if (-not $candidates) {
        return $null
    }

    $preferred = $candidates | Where-Object {
        $_.name -match "-x64\.exe$"
    } | Select-Object -First 1

    if ($preferred) {
        return $preferred
    }

    return $candidates | Select-Object -First 1
}

function Get-ReleaseChecksumAsset {
    param(
        [object[]]$Assets
    )

    return $Assets | Where-Object {
        $_.name -eq "SHA256SUMS.txt"
    } | Select-Object -First 1
}

function Get-ExpectedHashFromChecksumFile {
    param(
        [string]$ChecksumPath,
        [string]$AssetName
    )

    $line = Get-Content -LiteralPath $ChecksumPath | Where-Object {
        $_ -match "\s+$([regex]::Escape($AssetName))$"
    } | Select-Object -First 1

    if (-not $line) {
        return $null
    }

    $parts = $line -split "\s+", 2
    if ($parts.Count -lt 2) {
        return $null
    }

    return $parts[0].Trim().ToLowerInvariant()
}

function Verify-FileChecksum {
    param(
        [string]$FilePath,
        [string]$ExpectedHash
    )

    $actualHash = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedHash) {
        throw "Checksum verification failed for $(Split-Path -Leaf $FilePath). Expected $ExpectedHash but got $actualHash."
    }
}

function Install-FromRelease {
    param(
        [string]$ReleaseOwner,
        [string]$ReleaseRepo
    )

    $assets = Get-LatestReleaseAssets -ReleaseOwner $ReleaseOwner -ReleaseRepo $ReleaseRepo
    if (-not $assets) {
        return $false
    }

    $asset = Get-ReleaseInstallerAsset -Assets $assets
    if (-not $asset) {
        return $false
    }

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "christina-installer-release"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $installerPath = Join-Path $tempDir $asset.name
    $checksumAsset = Get-ReleaseChecksumAsset -Assets $assets
    $checksumPath = if ($checksumAsset) { Join-Path $tempDir $checksumAsset.name } else { $null }

    Write-Step "Downloading latest Windows installer: $($asset.name)"
    Download-File -Url $asset.browser_download_url -Destination $installerPath

    if ($checksumAsset) {
        Write-Step "Downloading release checksums"
        Download-File -Url $checksumAsset.browser_download_url -Destination $checksumPath

        $expectedHash = Get-ExpectedHashFromChecksumFile -ChecksumPath $checksumPath -AssetName $asset.name
        if (-not $expectedHash) {
            throw "SHA256SUMS.txt did not contain a checksum entry for $($asset.name)."
        }

        Write-Step "Verifying installer checksum"
        Verify-FileChecksum -FilePath $installerPath -ExpectedHash $expectedHash
    } else {
        Write-Host "Checksum file not published with the latest release. Continuing without checksum verification." -ForegroundColor Yellow
    }

    Write-Step "Launching installer"
    Start-Process -FilePath $installerPath -Wait
    return $true
}

function Install-FromSource {
    param(
        [string]$SourceOwner,
        [string]$SourceRepo,
        [string]$SourceRef,
        [string]$TargetRoot
    )

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "christina-installer-source"
    $zipPath = Join-Path $tempDir "christina-source.zip"
    $extractRoot = Join-Path $tempDir "extract"

    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

    $sourceUrl = Get-SourceArchiveUrl -SourceOwner $SourceOwner -SourceRepo $SourceRepo -SourceRef $SourceRef
    Write-Step "Downloading CHRISTINA source from $SourceOwner/$SourceRepo@$SourceRef"
    Download-File -Url $sourceUrl -Destination $zipPath

    Write-Step "Extracting source archive"
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

    $sourceDir = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $sourceDir) {
        throw "Source archive did not contain an installable directory."
    }

    New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
    Write-Step "Installing files to $TargetRoot"
    Copy-Item -Path (Join-Path $sourceDir.FullName "*") -Destination $TargetRoot -Recurse -Force

    $launcherPath = Join-Path $TargetRoot "installer\windows\Launch-CHRISTINA.ps1"
    if (-not (Test-Path $launcherPath)) {
        throw "Expected launcher not found at $launcherPath."
    }

    Write-Step "Starting CHRISTINA setup"
    & $launcherPath
}

Write-Host "CHRISTINA Windows Installer" -ForegroundColor Magenta
Write-Host "Owner: $Owner  Repo: $Repo  Channel: $Channel" -ForegroundColor DarkGray

switch ($Channel) {
    "release" {
        if (-not (Install-FromRelease -ReleaseOwner $Owner -ReleaseRepo $Repo)) {
            throw "No Windows release installer was found in the latest GitHub release."
        }
    }
    "source" {
        Install-FromSource -SourceOwner $Owner -SourceRepo $Repo -SourceRef $Ref -TargetRoot $InstallRoot
    }
    default {
        if (-not (Install-FromRelease -ReleaseOwner $Owner -ReleaseRepo $Repo)) {
            Write-Step "No published Windows installer found; falling back to source install"
            Install-FromSource -SourceOwner $Owner -SourceRepo $Repo -SourceRef $Ref -TargetRoot $InstallRoot
        }
    }
}
