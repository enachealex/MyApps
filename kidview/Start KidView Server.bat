@echo off
title KidView server
cd /d "%~dp0server"

if not exist .venv\Scripts\python.exe (
    echo First run: setting things up. This takes a minute...
    python -m venv .venv || goto :fail
    .venv\Scripts\python.exe -m pip install -q --upgrade pip
    .venv\Scripts\python.exe -m pip install -q -r requirements.txt || goto :fail
)

rem YouTube changes often, and yt-dlp updates to keep up. Grab the latest each start.
echo Checking for yt-dlp updates...
.venv\Scripts\python.exe -m pip install -q -U "yt-dlp[default]"

echo.
.venv\Scripts\python.exe -u -X utf8 app.py
goto :eof

:fail
echo.
echo Something went wrong during setup. Is Python installed?
pause
