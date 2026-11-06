# Builds a new KidView version and uploads it to your website as a DRAFT:
#
#   .\scripts\release.ps1 1.1.0
#
# Families aren't told about it: the files sit in a 1.1.0 folder on your site that nothing points to.
# Install them, try them, and when you're happy run   .\scripts\publish.ps1 1.1.0
# Running this again with the same version rebuilds the draft (until it's published).
param(
    [Parameter(Mandatory)][string]$Version,
    [string]$Config = "$PSScriptRoot\site.json",
    [switch]$Yes    # don't ask before starting
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot\site.ps1"

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Use a version like 1.1.0" }
$cfg = Get-SiteConfig $Config
if (-not (Test-Path android\signing\keystore.properties)) {
    throw "The signing key (android\signing) is missing. Restore it from your backup: apps signed with another key can't update."
}

# What's new: the "## <version>" section of RELEASE_NOTES.md. Parents read it before choosing to update.
$lines = @(Get-Content RELEASE_NOTES.md)
$start = [array]::IndexOf(@($lines | ForEach-Object { $_.Trim() }), "## $Version")
if ($start -lt 0) { throw "Add a '## $Version' section to RELEASE_NOTES.md saying what changed, then run this again." }
$notes = @(); for ($i = $start + 1; $i -lt $lines.Count -and $lines[$i] -notmatch '^## '; $i++) { $notes += $lines[$i] }
$notes = ($notes -join "`n").Trim()

# Never reuse a version families already have.
$live = $null
try { $live = Invoke-RestMethod "$($cfg.url)latest.json" -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 15 } catch { }
if ($live.version -and [version]$live.version -ge [version]$Version) {
    throw "Version $($live.version) is already published. Use a higher version."
}

$props = @(Get-Content android\gradle.properties)
$current = ($props | Select-String '^VERSION_NAME=(.+)$').Matches[0].Groups[1].Value.Trim()
$code = [int]($props | Select-String '^VERSION_CODE=(\d+)$').Matches[0].Groups[1].Value
if ([version]$Version -lt [version]$current) { throw "$Version is older than the version in the code ($current)." }
$bump = [version]$Version -gt [version]$current

Write-Host "KidView $Version -> draft at $($cfg.url)$Version/" -ForegroundColor Cyan
if (-not $Yes -and (Read-Host "Build and upload it? Families won't see it until you publish. (y/N)") -notmatch '^[yY]') { exit }

Write-Host "==> Setting the version and website address" -ForegroundColor Cyan
if ($bump) { $code++ }
$props = $props -replace '^VERSION_NAME=.*$', "VERSION_NAME=$Version" -replace '^VERSION_CODE=.*$', "VERSION_CODE=$code" `
                -replace '^KIDVIEW_SITE=.*$', "KIDVIEW_SITE=$($cfg.url)"
[IO.File]::WriteAllText("$PWD\android\gradle.properties", ($props -join "`n") + "`n")
$py = Get-Content server\version.py -Raw
$py = $py -replace '(?m)^VERSION = "[^"]*"', "VERSION = `"$Version`"" -replace '(?m)^SITE = "[^"]*"', "SITE = `"$($cfg.url)`""
[IO.File]::WriteAllText("$PWD\server\version.py", $py)

Write-Host "==> Building the apps" -ForegroundColor Cyan
Push-Location android
& .\gradlew.bat :app:assembleRelease :parent:assembleRelease --console=plain -q
$ok = $LASTEXITCODE -eq 0
Pop-Location
if (-not $ok) { throw "The app build failed (see above)." }

$out = "dist\site\$Version"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null
$files = [ordered]@{
    kids_apk   = "KidView-$Version.apk"
    parent_apk = "KidView-Parent-$Version.apk"
    windows    = "KidView-Server-Windows-$Version.zip"
    server     = "kidview-server-$Version.tar.gz"
}
Copy-Item android\app\build\outputs\apk\release\app-release.apk "$out\$($files.kids_apk)"
Copy-Item android\parent\build\outputs\apk\release\parent-release.apk "$out\$($files.parent_apk)"

Write-Host "==> Packaging the server" -ForegroundColor Cyan
$tmp = Join-Path ([IO.Path]::GetTempPath()) "kidview-pkg-$Version"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
$serverFiles = @(Get-ChildItem server -File | Where-Object { $_.Extension -in '.py', '.html', '.txt' })
# Windows: Install/Uninstall KidView.cmd + the server files
New-Item -ItemType Directory -Force "$tmp\win\server" | Out-Null
Copy-Item windows\*.cmd, windows\*.ps1 "$tmp\win"
$serverFiles | Copy-Item -Destination "$tmp\win\server"
Compress-Archive -Path "$tmp\win\*" -DestinationPath "$out\$($files.windows)" -Force
# Docker: the server files + Dockerfile, built on the family's server by install.sh
New-Item -ItemType Directory -Force "$tmp\docker" | Out-Null
$serverFiles | Copy-Item -Destination "$tmp\docker"
Copy-Item server\Dockerfile, server\docker-entrypoint.sh, server\.dockerignore "$tmp\docker"
& "$env:SystemRoot\System32\tar.exe" -czf "$out\$($files.server)" -C "$tmp\docker" .
if ($LASTEXITCODE -ne 0) { throw "Packaging the Docker server failed." }
Remove-Item -Recurse -Force $tmp

$sha = [ordered]@{}
$release = [ordered]@{ version = $Version; date = (Get-Date -Format 'yyyy-MM-dd'); notes = $notes }
foreach ($k in $files.Keys) {
    $path = "$Version/$($files[$k])"
    $release[$k] = $path
    $sha[$path] = (Get-FileHash "$out\$($files[$k])" -Algorithm SHA256).Hash.ToLower()
}
$release.sha256 = $sha
[IO.File]::WriteAllText("$PWD\$out\release.json", ($release | ConvertTo-Json -Depth 4))

Write-Host "==> Uploading the draft" -ForegroundColor Cyan
Send-ToSite $cfg $out $Version
# With the MyApps repo, this commits the draft (and the version change) and pushes it.
Complete-Upload $cfg "KidView $Version (draft)" @('android/gradle.properties', 'server/version.py', 'RELEASE_NOTES.md')

Write-Host ""
Write-Host "Draft $Version is ready. Families can't see it yet." -ForegroundColor Green
if ("$($cfg.upload.method)" -eq 'none') { Write-Host "Upload the folder $out to $($cfg.url)$Version/ yourself." }
Write-Host "Try it:"
Write-Host "  Kids' app:   $($cfg.url)$Version/$($files.kids_apk)"
Write-Host "  Parent app:  $($cfg.url)$Version/$($files.parent_apk)"
Write-Host "  Windows:     $($cfg.url)$Version/$($files.windows)"
Write-Host "When it's good, send it to every family:   .\scripts\publish.ps1 $Version"
