# Sends a tested draft to every family:   .\scripts\publish.ps1 1.1.0
#
# Updates latest.json, the download page and the Docker installer on the website. From then on the
# apps, the Windows tray and the dashboards offer the update (each family still chooses when).
# To stop offering a bad version, publish the previous one again: nobody is moved backwards,
# but nobody else is offered the bad one.
param(
    [Parameter(Mandatory)][string]$Version,
    [string]$Config = "$PSScriptRoot\site.json",
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot\site.ps1"

$cfg = Get-SiteConfig $Config
$site = "dist\site"
$draft = "$site\$Version\release.json"
if (-not (Test-Path $draft)) { throw "No draft for $Version on this PC. Run .\scripts\release.ps1 $Version first." }
$rel = Get-Content $draft -Raw | ConvertFrom-Json

Write-Host "Publish KidView $Version to $($cfg.url)" -ForegroundColor Cyan
Write-Host "Every family's apps and server will offer this update."
if (-not $Yes -and (Read-Host "Publish it? (y/N)") -notmatch '^[yY]') { exit }

# Docker installs read which server package is newest (and its checksum) from this one line.
[IO.File]::WriteAllText("$PWD\$site\server-latest.txt", "$($rel.server) $($rel.sha256.($rel.server))`n")
[IO.File]::WriteAllText("$PWD\$site\install.sh", ((Get-Content docker\install.sh -Raw) -replace '__SITE__', $cfg.url -replace "`r`n", "`n"))

# The download page
function Html([string]$s) { [Net.WebUtility]::HtmlEncode($s) }
$notesHtml = ""; $inList = $false
foreach ($line in ($rel.notes -split "`n")) {
    $t = $line.Trim()
    if ($t -match '^[-*] (.+)$') {
        if (-not $inList) { $notesHtml += "<ul>"; $inList = $true }
        $notesHtml += "<li>$(Html $Matches[1])</li>"
    } else {
        if ($inList) { $notesHtml += "</ul>"; $inList = $false }
        if ($t) { $notesHtml += "<p>$(Html $t)</p>" }
    }
}
if ($inList) { $notesHtml += "</ul>" }
$fill = [ordered]@{
    '{{VERSION}}'     = $Version
    '{{DATE}}'        = ([datetime]$rel.date).ToString('MMMM d, yyyy', [Globalization.CultureInfo]::InvariantCulture)
    '{{KIDS_APK}}'    = $rel.kids_apk
    '{{PARENT_APK}}'  = $rel.parent_apk
    '{{WINDOWS_ZIP}}' = $rel.windows
    '{{SITE}}'        = $cfg.url
    '{{NOTES}}'       = $notesHtml
}
$page = Get-Content site\index.html -Raw
foreach ($k in $fill.Keys) { $page = $page.Replace($k, [string]$fill[$k]) }
[IO.File]::WriteAllText("$PWD\$site\index.html", $page)
Copy-Item $draft "$site\latest.json" -Force

Write-Host "==> Uploading" -ForegroundColor Cyan
Send-ToSite $cfg "$site\$Version" $Version
foreach ($f in 'server-latest.txt', 'install.sh', 'index.html') {
    Send-ToSite $cfg "$site\$f" $f
}
Send-ToSite $cfg "$site\latest.json" 'latest.json'   # last, so everything it points to is already there
Complete-Upload $cfg "Publish KidView $Version"

Write-Host ""
if ("$($cfg.upload.method)" -eq 'none') {
    Write-Host "Upload everything in $site to $($cfg.url) (latest.json last)." -ForegroundColor Yellow
} else {
    Write-Host "KidView $Version is published: $($cfg.url)" -ForegroundColor Green
    Write-Host "It's live once the site finishes rebuilding (a few minutes). The apps check every few hours; the servers twice a day."
}
