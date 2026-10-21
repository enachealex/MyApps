<#
.SYNOPSIS
    Checks out every upstream ArtCraft repository at the commit pinned in upstream.lock.

.DESCRIPTION
    Each repository lands in vendor/<name> as a shallow, detached checkout with upstream's own
    line endings, reset to exactly that commit, and then gets the suite's compatibility patches
    from patches/<name>/*.patch (in name order). Safe to run before every build: a repository
    already at its commit is only reset and re-patched.

.PARAMETER Only
    Fetch just these names from upstream.lock (default: all of them).

.EXAMPLE
    ./scripts/fetch-upstream.ps1
    ./scripts/fetch-upstream.ps1 -Only wordcraft,gridcraft
#>
param([string[]]$Only)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null

function Invoke-Git {
    git @args
    if ($LASTEXITCODE) { throw "git $args failed" }
}

foreach ($line in Get-Content (Join-Path $root 'upstream.lock')) {
    $line = $line.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $name, $commit, $version, $url = $line -split '\s+'
    if ($Only -and $Only -notcontains $name) { continue }

    $dir = Join-Path $vendor $name
    if (-not (Test-Path (Join-Path $dir '.git'))) {
        Invoke-Git init --quiet $dir
        Invoke-Git -C $dir remote add origin $url
    }
    # Upstream's line endings, whatever this machine's git prefers.
    Invoke-Git -C $dir config core.autocrlf false
    $have = git -C $dir rev-parse --verify --quiet HEAD 2>$null
    if ($have -ne $commit) {
        Write-Host ("{0,-16} -> {1}" -f $name, $commit.Substring(0, 12))
        Invoke-Git -C $dir fetch --quiet --depth 1 origin $commit
        Invoke-Git -C $dir -c advice.detachedHead=false checkout --quiet --force FETCH_HEAD
    } else {
        Write-Host ("{0,-16} at {1}" -f $name, $commit.Substring(0, 12))
    }
    $patchDir = Join-Path $root "patches/$name"
    $patches = @(if (Test-Path $patchDir) { Get-ChildItem $patchDir -Filter *.patch | Sort-Object Name })
    # Already exactly the commit plus its patches: leave the files alone, so cargo has nothing to
    # rebuild. Otherwise back to the commit, and patch.
    $changed = @(git -C $dir diff --name-only HEAD | Sort-Object -Unique)
    $touched = @($patches | ForEach-Object { git -C $dir apply --numstat $_.FullName | ForEach-Object { ($_ -split "`t")[2] } } | Sort-Object -Unique)
    $reversible = -not ($patches | Where-Object { git -C $dir apply --reverse --check $_.FullName 2>$null; $LASTEXITCODE })
    if (($changed -join "`n") -eq ($touched -join "`n") -and ($patches.Count -eq 0 -or $reversible)) { continue }
    Invoke-Git -C $dir reset --quiet --hard
    foreach ($patch in $patches) {
        Write-Host ("{0,-16}    + {1}" -f '', $patch.Name)
        Invoke-Git -C $dir apply --whitespace=nowarn $patch.FullName
    }
}
