<#
.SYNOPSIS
    Builds ArtCraft Studio and ArtCraft Docs and puts the two programs in dist\.

.DESCRIPTION
    Fetches the pinned upstream apps (scripts/fetch-upstream.ps1), builds both windows in release
    mode, and copies craft-studio.exe and craft-docs.exe to dist\. The programs need nothing
    else, so everything under target\ is only a build cache: it makes the next build quicker,
    and can be deleted at any time.

.PARAMETER Clean
    Delete the build cache (target\) afterwards. Frees several GB; the next build then starts from
    scratch (about 20 minutes).

.EXAMPLE
    ./scripts/build.ps1
    ./scripts/build.ps1 -Clean
#>
param([switch]$Clean)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'fetch-upstream.ps1')

Push-Location $root
try {
    cargo build --release -p craft-studio -p craft-docs
    if ($LASTEXITCODE) { throw 'cargo build failed' }

    $dist = Join-Path $root 'dist'
    New-Item -ItemType Directory -Force $dist | Out-Null
    foreach ($exe in 'craft-studio.exe', 'craft-docs.exe') {
        try {
            Copy-Item (Join-Path $root "target\release\$exe") $dist -Force
        } catch {
            throw "Couldn't replace dist\$exe ($($_.Exception.Message)). Close ArtCraft Studio and ArtCraft Docs, then run this again."
        }
    }
    Write-Host "Built $dist\craft-studio.exe and $dist\craft-docs.exe"

    if ($Clean) {
        cargo clean
        if ($LASTEXITCODE) { throw 'cargo clean failed' }
    }
} finally {
    Pop-Location
}
