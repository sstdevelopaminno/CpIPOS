@echo off
setlocal
cd /d "%~dp0"
if "%CPIPOS_WINDOWS_PRINTER%"=="" (
  echo [CpIPOS Print Bridge] CPIPOS_WINDOWS_PRINTER is not set. Windows default printer will be used.
  echo [CpIPOS Print Bridge] To force a printer, edit this file and set CPIPOS_WINDOWS_PRINTER=MTP-II or your Windows printer name.
) else (
  echo [CpIPOS Print Bridge] Using printer: %CPIPOS_WINDOWS_PRINTER%
)
echo [CpIPOS Print Bridge] Starting http://127.0.0.1:3210/print
node server.mjs
pause
