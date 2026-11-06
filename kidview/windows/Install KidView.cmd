@echo off
rem Double-click to install (or update) the KidView server on this PC.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
