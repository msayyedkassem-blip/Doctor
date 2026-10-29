@echo off
rem  Opens the clinic. Double-click this.
rem
rem  If it is already running this just opens it in the browser; otherwise it
rem  starts it first and waits until it is really answering.

setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo.
  echo   Get it from https://nodejs.org - press the big green LTS button,
  echo   click through the installer leaving everything as it is, then
  echo   double-click this file again.
  echo.
  pause
  exit /b 1
)

node --no-warnings scripts\windows.js start
if errorlevel 1 pause
exit /b 0
