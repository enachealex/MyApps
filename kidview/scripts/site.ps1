# Shared by release.ps1 and publish.ps1: reads scripts/site.json and puts files on the KidView website.
#
# site.json:
#   "url"     the web address of KidView's downloads, ending in /
#   "upload"  how files get there:
#      { "method": "git", "folder": "downloads" }   KidView lives in the MyApps repo: copy into kidview/downloads,
#                                                   then commit and push. GitHub Pages publishes that folder at url.
#      { "method": "folder", "target": "D:\\Sites\\example.com\\kidview" }   copy into a folder
#      { "method": "scp", "target": "me@example.com:/var/www/example.com/kidview" }   copy over SSH
#      { "method": "none" }   leave the files in dist\site for you to upload yourself

$ProjectDir = Split-Path $PSScriptRoot -Parent

function Get-SiteConfig([string]$Path) {
    if (-not (Test-Path $Path)) { throw "Missing $Path. See RELEASING.md." }
    $cfg = Get-Content $Path -Raw | ConvertFrom-Json
    if (-not $cfg.url -or $cfg.url -match 'YOUR-SITE') { throw "Put your website's address in $Path first (see RELEASING.md)." }
    if (-not $cfg.url.EndsWith('/')) { $cfg.url += '/' }
    return $cfg
}

function Get-DownloadsFolder($Cfg) {
    $folder = "$($Cfg.upload.folder)"
    if (-not $folder) { $folder = 'downloads' }
    return $folder
}

function Copy-Into([string]$LocalPath, [string]$Dest) {
    if (Test-Path $LocalPath -PathType Container) {
        New-Item -ItemType Directory -Force $Dest | Out-Null
        Copy-Item "$LocalPath\*" $Dest -Recurse -Force
    } else {
        New-Item -ItemType Directory -Force (Split-Path $Dest -Parent) | Out-Null
        Copy-Item $LocalPath $Dest -Force
    }
}

# Copies a file or folder from dist\site to the same place on the website (RemotePath is relative, '' = the top).
function Send-ToSite($Cfg, [string]$LocalPath, [string]$RemotePath = '') {
    $method = "$($Cfg.upload.method)"
    $target = "$($Cfg.upload.target)".TrimEnd('/', '\')
    switch ($method) {
        'git' {
            $base = Join-Path $ProjectDir (Get-DownloadsFolder $Cfg)
            Copy-Into $LocalPath $(if ($RemotePath) { Join-Path $base $RemotePath } else { $base })
        }
        'folder' {
            if (-not $target) { throw "site.json: upload.target needs a folder." }
            Copy-Into $LocalPath $(if ($RemotePath) { Join-Path $target $RemotePath } else { $target })
        }
        'scp' {
            $sshHost, $dir = $target -split ':', 2
            if (-not $dir) { throw "site.json: upload.target should look like user@host:/path/to/kidview" }
            $remote = if ($RemotePath) { "$dir/$RemotePath" } else { $dir }
            if (Test-Path $LocalPath -PathType Container) {
                ssh $sshHost "mkdir -p '$remote'"
                scp -q -r "$LocalPath\*" "${sshHost}:$remote/"
            } else {
                ssh $sshHost "mkdir -p '$(Split-Path $remote -Parent | ForEach-Object { $_ -replace '\\', '/' })'"
                scp -q $LocalPath "${sshHost}:$remote"
            }
            if ($LASTEXITCODE -ne 0) { throw "Uploading $LocalPath failed." }
        }
        'none' { }
        default { throw "site.json: upload.method should be git, folder, scp or none." }
    }
}

# For "git": commits the downloads folder (plus $Paths, e.g. the version bump) and pushes.
# GitHub Pages then rebuilds myapps.thejumpvault.com, which takes a couple of minutes.
function Complete-Upload($Cfg, [string]$Message, [string[]]$Paths = @()) {
    if ("$($Cfg.upload.method)" -ne 'git') { return }
    $all = @(Get-DownloadsFolder $Cfg) + $Paths
    Push-Location $ProjectDir
    try {
        git add -- $all
        if (git diff --cached --name-only -- $all) {
            git commit -q -m $Message -- $all
            if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
        }
        git push -q
        if ($LASTEXITCODE -ne 0) { throw "git push failed. The commit is saved: run 'git push' when you can." }
    } finally { Pop-Location }
}
