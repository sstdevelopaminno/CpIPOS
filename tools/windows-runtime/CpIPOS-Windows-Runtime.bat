@echo off
setlocal

title CpIPOS Windows Runtime
set SCRIPT_DIR=%~dp0

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-cpipos-windows-runtime.ps1"

if errorlevel 1 (
  echo.
  echo CpIPOS Windows Runtime failed to start.
  echo Please check Node.js, Microsoft Edge, and the local repository path.
  pause
)
