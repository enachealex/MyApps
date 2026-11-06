# Removes the KidView server from this PC. Run "Uninstall KidView.cmd" (double-click).
param([string]$InstallDir = "$env:LOCALAPPDATA\KidView")
$ErrorActionPreference = 'Continue'

Write-Host "Removing KidView..." -ForegroundColor Magenta
Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -like "*kidview_tray.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup'))) {
    Remove-Item "$folder\KidView.lnk" -ErrorAction SilentlyContinue
}
try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", "netsh advfirewall firewall delete rule name=KidView" }
catch { }

Remove-Item -Recurse -Force "$InstallDir\app", "$InstallDir\venv", "$InstallDir\kidview.ico" -ErrorAction SilentlyContinue

$keep = Read-Host "Keep your KidView settings, activity and saved videos in case you reinstall? (Y/n)"
if ($keep -match '^[nN]') {
    Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    Write-Host "Everything was removed."
} else {
    Write-Host "Settings were kept in $InstallDir\data."
}
Write-Host "KidView is uninstalled." -ForegroundColor Green
