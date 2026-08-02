# CpIPOS Windows cleanup helper
# Run after uninstalling old CpIPOS Windows Runtime/Mobile shortcuts.
# This removes old shortcut names and refreshes Windows Explorer icon cache.

$ErrorActionPreference = "SilentlyContinue"

$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\CpIPOS"
$oldShortcutNames = @(
  "CpIPOS Windows Runtime.lnk",
  "CpIpOS Mobile.lnk",
  "CpIPOS Mobile.lnk",
  "CpIPOS Windo.lnk",
  "CpIPOS.lnk"
)

foreach ($name in $oldShortcutNames) {
  Remove-Item -Force (Join-Path $desktop $name)
  Remove-Item -Force (Join-Path $startMenu $name)
}

# Keep this message before restarting Explorer.
Write-Host "Old CpIPOS shortcuts removed. Refreshing Windows icon cache..." -ForegroundColor Cyan

Stop-Process -Name explorer -Force
Remove-Item -Force "$env:LOCALAPPDATA\IconCache.db"
Remove-Item -Force "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*"
Start-Process explorer.exe

Write-Host "Done. Reinstall CpIPOS Windows from the latest installer, then keep only the shortcut named CpIPOS." -ForegroundColor Green
