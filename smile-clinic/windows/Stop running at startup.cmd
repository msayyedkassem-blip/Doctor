@echo off
rem  Undoes "Run at startup". The app itself is left alone.

setlocal
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Smile Clinic.lnk"

if exist "%LINK%" (
  del "%LINK%"
  echo.
  echo   The clinic will no longer start by itself.
  echo   You can still open it with "Start Smile Clinic".
) else (
  echo.
  echo   It was not set to start by itself.
)
echo.
pause
