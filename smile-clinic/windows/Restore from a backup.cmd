@echo off
rem  Puts a backup back, or takes a phone's backup as the clinic's records.
rem
rem  DRAG THE BACKUP FILE ONTO THIS FILE and let go. Dropping a file on a .cmd
rem  hands it the path, which saves a person typing one.

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

if "%~1"=="" (
  echo.
  echo   Drag the backup file onto this one and let go.
  echo.
  echo   It is the file the phone saved - clinic-backup-....db - or one from
  echo   the backups folder on this computer.
  echo.
  pause
  exit /b 1
)

echo.
echo   Stopping the clinic, if it is running...
node --no-warnings scripts\running.js stop

node --no-warnings scripts\restore.js "%~1"
if errorlevel 1 (
  echo.
  echo   Nothing was changed.
  echo.
  pause
  exit /b 1
)

echo.
echo   Now double-click "Start Smile Clinic".
echo.
pause
exit /b 0
