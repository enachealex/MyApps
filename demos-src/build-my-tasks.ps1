<#
.SYNOPSIS
  Builds the public My Tasks demo.

.DESCRIPTION
  The demo is a separate, stripped copy of the app that runs entirely in the
  visitor's browser. This script rebuilds it end to end so the hardening can
  never be lost by a plain `expo export`:

      demos-src/my-tasks   (stripped source)
        -> expo export --platform web
        -> demos/my-tasks  (what the launcher embeds)
        -> patch index.html (demo title + noindex)
        -> VERIFY

  The verification step is the point. A build that merely "succeeded" is not
  proof, so this asserts the properties the demo is supposed to have and
  fails loudly if any of them regressed:

    * no service worker and no web manifest are shipped
    * asset paths are rooted at /demos/my-tasks (not /my-tasks)
    * the demo data service is in-memory (no AsyncStorage import)
    * Firebase is not configured, so there is no network path at all

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File demos-src/build-my-tasks.ps1
#>

$ErrorActionPreference = 'Stop'

$repo    = Split-Path -Parent $PSScriptRoot      # ...\MyApps
$srcApp  = Join-Path $repo 'my-tasks'            # the real app (for node_modules)
$demoSrc = Join-Path $PSScriptRoot 'my-tasks'    # the stripped copy we build
$outDir  = Join-Path $repo 'demos\my-tasks'      # what the launcher embeds
$baseUrl = '/demos/my-tasks'

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok  ($msg) { Write-Host "   OK   $msg" -ForegroundColor Green }
function Die ($msg) { Write-Host "   FAIL $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $demoSrc)) { Die "Demo source missing: $demoSrc" }

# ── node_modules ──────────────────────────────────────────────────────────
# The demo copy reuses the real app's node_modules through a junction, so
# there is only ever one install to keep current.
Step 'Checking node_modules junction'
$nm = Join-Path $demoSrc 'node_modules'
if (-not (Test-Path (Join-Path $nm 'expo'))) {
    if (Test-Path $nm) { Remove-Item $nm -Recurse -Force }
    if (-not (Test-Path (Join-Path $srcApp 'node_modules\expo'))) {
        Die "The real app has no node_modules. Run 'npm install' in $srcApp first."
    }
    New-Item -ItemType Junction -Path $nm -Target (Join-Path $srcApp 'node_modules') | Out-Null
    Ok 'junction recreated'
} else {
    Ok 'present'
}

# ── Guard: the stripped source must still be stripped ─────────────────────
Step 'Checking the demo source is still hardened'
# Match a real import, not the word appearing in a comment.
$localSvc = Get-Content (Join-Path $demoSrc 'src\data\localService.ts') -Raw
if ($localSvc -match "(?m)^\s*import\s.*async-storage") {
    Die 'localService.ts imports AsyncStorage - the demo must be in-memory only.'
}
if ($localSvc -match "(?m)^\s*(?!.*//).*\bAsyncStorage\.(get|set|remove|multi)") {
    Die 'localService.ts calls AsyncStorage - the demo must be in-memory only.'
}
Ok 'data service is in-memory'

$fbCfg = Get-Content (Join-Path $demoSrc 'firebase.config.ts') -Raw
if ($fbCfg -notmatch 'firebaseConfig\s*(:[^=]*)?=\s*null') { Die 'firebase.config.ts is populated - the demo must have no backend.' }
Ok 'firebase not configured (no network path)'

foreach ($f in @('public\sw.js', 'public\manifest.webmanifest')) {
    if (Test-Path (Join-Path $demoSrc $f)) { Die "$f exists - the demo must not be installable." }
}
Ok 'no service worker / manifest in source'

$appJson = Get-Content (Join-Path $demoSrc 'app.json') -Raw
if ($appJson -notmatch [regex]::Escape("`"baseUrl`": `"$baseUrl`"")) {
    Die "app.json baseUrl is not `"$baseUrl`" - assets would 404 under the demo path."
}
Ok "baseUrl is $baseUrl"

# ── Build ─────────────────────────────────────────────────────────────────
Step 'Exporting the web build (this takes a few minutes)'
Push-Location $demoSrc
try {
    $dist = Join-Path $demoSrc 'dist'
    if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
    $env:CI = '1'
    & npx expo export --platform web 2>&1 | Select-Object -Last 6 | ForEach-Object { "   $_" }
    if ($LASTEXITCODE -ne 0) { Die "expo export exited $LASTEXITCODE" }
    if (-not (Test-Path (Join-Path $dist 'index.html'))) { Die 'export produced no index.html' }
} finally {
    Pop-Location
}
Ok 'exported'

# ── Deploy ────────────────────────────────────────────────────────────────
Step "Publishing to $outDir"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
robocopy (Join-Path $demoSrc 'dist') $outDir /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null
if ($LASTEXITCODE -ge 8) { Die "robocopy failed ($LASTEXITCODE)" }   # 0-7 are success codes
$global:LASTEXITCODE = 0
Ok 'copied'

# ── Patch the exported page ───────────────────────────────────────────────
# expo export regenerates index.html every time, so these edits are applied
# here rather than by hand.
Step 'Patching index.html'
$idx  = Join-Path $outDir 'index.html'
$html = Get-Content $idx -Raw
$html = $html -replace '<title>[^<]*</title>', '<title>My Tasks &#8212; Demo | Jump Vault</title>'
if ($html -notmatch 'name="robots"') {
    $html = $html -replace '(<meta name="viewport"[^>]*/>)', @'
$1
    <meta name="robots" content="noindex, nofollow" />
    <meta name="description" content="Try My Tasks. Demo only: nothing is saved and no data leaves your browser." />
'@
}

# The launcher embeds this in an opaque-origin frame it cannot read, so the
# demo has to announce itself. Without this beacon the launcher cannot tell
# "running" from "blocked by a content blocker" and would show a blank box.
if ($html -notmatch 'jvdemo-ready') {
    $beacon = @'
<script>try{if(window.parent!==window)window.parent.postMessage({type:"jvdemo-ready"},"*");}catch(e){}</script>
</body>
'@
    $html = $html -replace '</body>', $beacon
}
Set-Content $idx -Value $html -Encoding UTF8
Ok 'title + noindex + ready-beacon applied'

# ── Verify the published output ───────────────────────────────────────────
Step 'Verifying the published demo'
$published = Get-Content $idx -Raw

if (Test-Path (Join-Path $outDir 'sw.js'))                { Die 'sw.js was published - the demo would install itself.' }
if (Test-Path (Join-Path $outDir 'manifest.webmanifest')) { Die 'manifest.webmanifest was published.' }
Ok 'no service worker / manifest published'

if ($published -notmatch 'noindex')                       { Die 'noindex missing from index.html' }
Ok 'noindex present'

if ($published -notmatch 'jvdemo-ready') { Die 'ready-beacon missing - the launcher would show a blank box instead of a fallback.' }
Ok 'ready-beacon present'

if ($published -notmatch [regex]::Escape("$baseUrl/_expo/")) { Die "script src is not under $baseUrl - assets will 404." }
if ($published -match 'src="/my-tasks/')                     { Die 'index.html still points at /my-tasks/.' }
Ok 'asset paths correct'

$bundle = Get-ChildItem (Join-Path $outDir '_expo\static\js\web') -Filter *.js -ErrorAction SilentlyContinue |
          Sort-Object Length -Descending | Select-Object -First 1
if (-not $bundle) { Die 'no JS bundle found' }
Ok ("bundle {0} ({1:N1} MB)" -f $bundle.Name, ($bundle.Length / 1MB))

Write-Host "`nDemo rebuilt: $outDir" -ForegroundColor Green
Write-Host "Embed path for the launcher: demos/my-tasks/`n"
