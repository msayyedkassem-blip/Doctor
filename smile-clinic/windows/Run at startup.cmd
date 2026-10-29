@echo off
rem  Makes the clinic start by itself every time this computer is switched on.
rem
rem  It puts one small file in the Startup folder, which is the plain Windows
rem  way of doing this: nothing is installed, nothing runs as a service, and
rem  "Stop running at startup" undoes it completely.

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

node --no-warnings scripts\windows.js autostart on
pause
exit /b 0
