@echo off
rem  Opens the clinic. Double-click this.
rem
rem  It starts the server if it is not already up, waits for it to answer, and
rem  then opens the browser. If something goes wrong it says what, and keeps
rem  the window open long enough to read it.

setlocal
cd /d "%~dp0\.."

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo.
  echo   Get it from https://nodejs.org - choose the LTS version, click
  echo   through the installer, then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist logs mkdir logs

rem  Already running? Then just open it.
node --no-warnings scripts\running.js status >nul 2>&1
if not errorlevel 1 (
  start "" http://localhost:4000
  exit /b 0
)

echo.
echo   Starting the clinic...
start "Smile Clinic" /min cmd /c "node --no-warnings server\index.js >> logs\clinic.log 2>&1"

node --no-warnings scripts\running.js wait 25
if errorlevel 1 (
  echo.
  echo   The clinic did not start. The end of the log:
  echo.
  powershell -NoProfile -Command "Get-Content logs\clinic.log -Tail 20"
  echo.
  pause
  exit /b 1
)

start "" http://localhost:4000
exit /b 0
