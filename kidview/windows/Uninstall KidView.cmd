@echo off
rem Double-click to remove the KidView server from this PC.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-windows.ps1"
echo.
pause
