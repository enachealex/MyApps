# KidView server installer for Windows. Run "Install KidView.cmd" (double-click) rather than this file.
#
# Installs what KidView needs (Python, Deno, ffmpeg) with winget if they're missing, sets KidView up in
# %LOCALAPPDATA%\KidView, adds Start menu + start-with-Windows shortcuts, and starts it.
# Running it again updates an existing install and keeps all settings.
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\KidView",
    [switch]$NoShortcuts,   # for testing
    [switch]$NoFirewall,
    [switch]$NoLaunch,
    [switch]$SkipPrereqs    # for testing on a PC that shouldn't get new programs installed
)
$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Need($command, $wingetId, $label) {
    if (Get-Command $command -ErrorAction SilentlyContinue) { Write-Host "    $label is already installed"; return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$label is missing and winget isn't available. Install $label yourself, then run this again."
    }
    Write-Host "    Installing $label..."
    winget install --id $wingetId --exact --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Refresh-Path
}

# The server files sit next to this script in the release zip, or in ..\server in the source code.
$source = @("$PSScriptRoot\server", "$PSScriptRoot\..\server") | Where-Object { Test-Path "$_\app.py" } | Select-Object -First 1
if (-not $source) { throw "Can't find KidView's server files next to this installer." }

Write-Host "KidView installer" -ForegroundColor Magenta

Step "Checking what KidView needs"
Refresh-Path
if (-not $SkipPrereqs) {
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { Need 'py' 'Python.Python.3.13' 'Python' }
    else { Write-Host "    Python is already installed" }
    # yt-dlp needs a JavaScript runtime for YouTube: Deno (or Node.js, if that's already here).
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Need 'deno' 'DenoLand.Deno' 'Deno (lets KidView read YouTube)' }
    else { Write-Host "    Node.js is already installed" }
    Need 'ffmpeg' 'Gyan.FFmpeg' 'ffmpeg (for saved videos)'
}

Step "Stopping KidView if it's running"
Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -like "*kidview_tray.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Step "Copying KidView to $InstallDir"
$app = "$InstallDir\app"
New-Item -ItemType Directory -Force $app, "$InstallDir\data" | Out-Null
Get-ChildItem $source -File | Where-Object { $_.Extension -in '.py', '.html', '.txt' } | Copy-Item -Destination $app -Force

Step "Setting up Python packages (this takes a minute the first time)"
$venv = "$InstallDir\venv"
if (-not (Test-Path "$venv\Scripts\python.exe")) { py -3 -m venv $venv }
& "$venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check --upgrade pip
& "$venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r "$app\requirements.txt" pystray pillow
if ($LASTEXITCODE -ne 0) { throw "Installing Python packages failed. Check the internet connection and try again." }
& "$venv\Scripts\python.exe" -c "import sys; sys.path.insert(0, r'$app'); import kidview_tray; kidview_tray.save_icon(r'$InstallDir\kidview.ico')"

$pythonw = "$venv\Scripts\pythonw.exe"
$tray = "$app\kidview_tray.py"

if (-not $NoShortcuts) {
    Step "Adding KidView to the Start menu and to Windows startup"
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup'))) {
        $lnk = $shell.CreateShortcut("$folder\KidView.lnk")
        $lnk.TargetPath = $pythonw
        $lnk.Arguments = "`"$tray`""
        $lnk.WorkingDirectory = $app
        $lnk.IconLocation = "$InstallDir\kidview.ico"
        $lnk.Description = "KidView server"
        $lnk.Save()
    }
}

if (-not $NoFirewall) {
    Step "Letting tablets and phones on your Wi-Fi reach KidView"
    Write-Host "    Windows will ask for permission (this only allows your home network)."
    $rule = "netsh advfirewall firewall delete rule name=KidView | Out-Null; " +
            "netsh advfirewall firewall add rule name=KidView dir=in action=allow program=`"$pythonw`" profile=private,domain enable=yes"
    try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", $rule }
    catch { Write-Host "    Skipped. If Windows asks about KidView later, choose 'Allow' for private networks." -ForegroundColor Yellow }
}

if (-not $NoLaunch) {
    Step "Starting KidView"
    Start-Process $pythonw -ArgumentList "`"$tray`"" -WorkingDirectory $app
    Write-Host "    KidView is running (look for the purple icon by the clock)."
    Write-Host "    The dashboard opens in your browser the first time: http://localhost:8765/admin"
}

Write-Host ""
Write-Host "Done! Install the KidView app on each kid's device and scan the code on the dashboard." -ForegroundColor Green
