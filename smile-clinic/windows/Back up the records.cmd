@echo off
rem  Saves a copy of the whole clinic into the backups folder.
rem
rem  Safe to run while the clinic is being used - it never catches the records
rem  half-written. Copy the file it makes onto a USB stick or send it to
rem  yourself; a backup on the same computer does not survive that computer.

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

node --no-warnings scripts\backup.js
echo.
pause
exit /b 0
