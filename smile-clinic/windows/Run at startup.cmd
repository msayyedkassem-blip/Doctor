@echo off
rem  Makes the clinic start by itself every time this computer is switched on.
rem
rem  It puts a shortcut in the Startup folder, which is the plain Windows way
rem  of doing this - nothing is installed, nothing runs as a service, and
rem  "Stop running at startup" undoes it completely.

setlocal
set "APP=%~dp0Start Smile Clinic.cmd"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Smile Clinic.lnk"

powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%');" ^
  "$s.TargetPath = '%APP%';" ^
  "$s.WorkingDirectory = (Split-Path '%APP%');" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'Smile Clinic';" ^
  "$s.Save()"

if errorlevel 1 (
  echo.
  echo   Could not set it to start automatically.
  echo   The "Start Smile Clinic" file still works - double-click that.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done. The clinic will start by itself from now on.
echo   To undo this, double-click "Stop running at startup".
echo.
pause
