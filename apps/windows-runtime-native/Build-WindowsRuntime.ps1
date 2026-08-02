# CpIPOS Windows Runtime local build helper
# Usage examples:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\windows-runtime-native\Build-WindowsRuntime.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\windows-runtime-native\Build-WindowsRuntime.ps1 -CopyTo "F:\CpIPOS-WindowsRuntime"
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\windows-runtime-native\Build-WindowsRuntime.ps1 -SkipPull -CopyTo "F:\CpIPOS-WindowsRuntime"

[CmdletBinding()]
param(
  [string]$CopyTo = "",
  [switch]$SkipPull
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "`n[CpIPOS Windows Runtime] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn2([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$projectPath = Join-Path $repoRoot "apps\windows-runtime-native\Cpipos.WindowsRuntime\Cpipos.WindowsRuntime.csproj"
$outputDir = Join-Path $repoRoot "artifacts\CpIPOS-WindowsRuntime-win-x64"
$zipPath = Join-Path $repoRoot "artifacts\CpIPOS-WindowsRuntime-win-x64.zip"

Write-Step "Repo root: $repoRoot"

if (!(Test-Path $projectPath)) {
  throw "ไม่พบ project file: $projectPath"
}

$git = Get-Command git -ErrorAction SilentlyContinue
if (!$git) {
  Write-Warn2 "ไม่พบ git ใน PATH จะข้ามขั้นตอน git pull"
  $SkipPull = $true
}

if (!$SkipPull) {
  Write-Step "อัปเดตโค้ดล่าสุดจาก GitHub"
  Push-Location $repoRoot
  try {
    git fetch origin
    git checkout agent-docs-preflight-schema-drift
    git pull --ff-only origin agent-docs-preflight-schema-drift
    git log -1 --oneline
  } finally {
    Pop-Location
  }
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (!$dotnet) {
  throw "ไม่พบ .NET SDK กรุณาติดตั้ง .NET 8 SDK ก่อน: https://dotnet.microsoft.com/download/dotnet/8.0"
}

Write-Step "ตรวจ .NET SDK"
dotnet --version

Write-Step "ล้าง output เดิม"
if (Test-Path $outputDir) {
  Remove-Item -Recurse -Force $outputDir
}
if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Write-Step "Build Cpipos.WindowsRuntime.exe"
dotnet publish $projectPath `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -o $outputDir

$exePath = Join-Path $outputDir "Cpipos.WindowsRuntime.exe"
if (!(Test-Path $exePath)) {
  throw "Build เสร็จแต่ไม่พบไฟล์ EXE: $exePath"
}

@"
CpIPOS Windows Runtime
======================

Run:
  Cpipos.WindowsRuntime.exe
  Cpipos.WindowsRuntime.exe --printer="MTP-II"
  Cpipos.WindowsRuntime.exe --windowed

Local bridge inside the EXE:
  http://127.0.0.1:3210/health
  http://127.0.0.1:3210/printers
  http://127.0.0.1:3210/print/test
  http://127.0.0.1:3210/print

Notes:
- Uses the existing CpIPOS web UI.
- Includes a native local print bridge.
- Does not include offline sales database/sync engine yet.
- Microsoft Edge WebView2 Runtime is required.
"@ | Set-Content -Encoding UTF8 (Join-Path $outputDir "README-WINDOWS-RUNTIME.txt")

Write-Step "Zip ไฟล์สำหรับใส่ไดรฟ์"
Compress-Archive -Path (Join-Path $outputDir "*") -DestinationPath $zipPath -Force

Write-Ok "Build สำเร็จ"
Write-Host "EXE: $exePath" -ForegroundColor Green
Write-Host "ZIP: $zipPath" -ForegroundColor Green

if (![string]::IsNullOrWhiteSpace($CopyTo)) {
  Write-Step "Copy ไปที่ $CopyTo"
  New-Item -ItemType Directory -Force -Path $CopyTo | Out-Null
  Copy-Item -Force $zipPath (Join-Path $CopyTo "CpIPOS-WindowsRuntime-win-x64.zip")
  Copy-Item -Recurse -Force $outputDir (Join-Path $CopyTo "CpIPOS-WindowsRuntime-win-x64")
  Write-Ok "Copy สำเร็จ: $CopyTo"
}

Write-Step "ทดสอบเปิดโปรแกรม"
Write-Host "cd `"$outputDir`"" -ForegroundColor White
Write-Host ".\Cpipos.WindowsRuntime.exe --printer=`"MTP-II`"" -ForegroundColor White
