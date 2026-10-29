@echo off
rem  Undoes "Run at startup". The app and the records are left alone.

setlocal
cd /d "%~dp0.."

node --no-warnings scripts\windows.js autostart off
pause
exit /b 0
