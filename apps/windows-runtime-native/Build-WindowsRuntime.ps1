# CpIPOS Windows Runtime local build helper
# Usage examples:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\windows-runtime-native\Build-WindowsRuntime.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\windows-runtime-native\Build-WindowsRuntime.ps1 -CopyTo F:\CpIPOS-WindowsRuntime
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\windows-runtime-native\Build-WindowsRuntime.ps1 -SkipPull -CopyTo F:\CpIPOS-WindowsRuntime

[CmdletBinding()]
param(
  [string]$CopyTo = "",
  [switch]$SkipPull
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "[CpIPOS Windows Runtime] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn2([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Resolve-DotNetExe {
  $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) {
    return $cmd.Source
  }

  $candidates = @(
    "C:\Program Files\dotnet\dotnet.exe",
    "C:\Program Files (x86)\dotnet\dotnet.exe",
    "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  return ""
}

function Invoke-DotNet([string[]]$Arguments) {
  & $script:DotNetExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "dotnet command failed: $($Arguments -join ' ')"
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRootInfo = Resolve-Path (Join-Path $scriptDir "..\..")
$repoRoot = $repoRootInfo.Path
$projectPath = Join-Path $repoRoot "apps\windows-runtime-native\Cpipos.WindowsRuntime\Cpipos.WindowsRuntime.csproj"
$outputDir = Join-Path $repoRoot "artifacts\CpIPOS-WindowsRuntime-win-x64"
$artifactsDir = Join-Path $repoRoot "artifacts"
$zipPath = Join-Path $artifactsDir "CpIPOS-WindowsRuntime-win-x64.zip"

Write-Step "Repo root: $repoRoot"

if (!(Test-Path $projectPath)) {
  throw "Project file not found: $projectPath"
}

$git = Get-Command git -ErrorAction SilentlyContinue
if (!$git) {
  Write-Warn2 "git was not found in PATH. Skipping git pull."
  $SkipPull = $true
}

if (!$SkipPull) {
  Write-Step "Updating latest source from GitHub"
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

$script:DotNetExe = Resolve-DotNetExe
if ([string]::IsNullOrWhiteSpace($script:DotNetExe)) {
  throw "dotnet was not found. Install .NET 8 SDK first, then reopen PowerShell/VS Code."
}

Write-Step "Checking .NET SDK"
Write-Host "dotnet: $script:DotNetExe" -ForegroundColor White
$sdkList = & $script:DotNetExe --list-sdks
if ($LASTEXITCODE -ne 0) {
  throw "dotnet --list-sdks failed. Reinstall .NET 8 SDK."
}
$sdkList | ForEach-Object { Write-Host $_ -ForegroundColor White }
if (-not ($sdkList -match "^8\.")) {
  throw "No .NET 8 SDK was found. Installed SDKs: $($sdkList -join ', ')"
}

Write-Step "Cleaning previous output"
if (Test-Path $outputDir) {
  Remove-Item -Recurse -Force $outputDir
}
if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null

Write-Step "Building Cpipos.WindowsRuntime.exe"
$publishArgs = @(
  "publish",
  $projectPath,
  "-c", "Release",
  "-r", "win-x64",
  "--self-contained", "true",
  "-p:PublishSingleFile=true",
  "-p:IncludeNativeLibrariesForSelfExtract=true",
  "-p:EnableCompressionInSingleFile=true",
  "-o", $outputDir
)
Invoke-DotNet $publishArgs

$exePath = Join-Path $outputDir "Cpipos.WindowsRuntime.exe"
if (!(Test-Path $exePath)) {
  throw "Build finished but EXE was not found: $exePath"
}

$readmeText = @'
CpIPOS Windows Runtime
======================

Run:
  Cpipos.WindowsRuntime.exe
  Cpipos.WindowsRuntime.exe --printer MTP-II
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
'@
$readmeText | Set-Content -Encoding UTF8 (Join-Path $outputDir "README-WINDOWS-RUNTIME.txt")

Write-Step "Creating zip for USB drive"
Compress-Archive -Path (Join-Path $outputDir "*") -DestinationPath $zipPath -Force

Write-Ok "Build completed"
Write-Host "EXE: $exePath" -ForegroundColor Green
Write-Host "ZIP: $zipPath" -ForegroundColor Green

if (![string]::IsNullOrWhiteSpace($CopyTo)) {
  Write-Step "Copying files to $CopyTo"
  New-Item -ItemType Directory -Force -Path $CopyTo | Out-Null
  Copy-Item -Force $zipPath (Join-Path $CopyTo "CpIPOS-WindowsRuntime-win-x64.zip")
  Copy-Item -Recurse -Force $outputDir (Join-Path $CopyTo "CpIPOS-WindowsRuntime-win-x64")
  Write-Ok "Copy completed: $CopyTo"
}

Write-Step "Run test command"
Write-Host "cd $outputDir" -ForegroundColor White
Write-Host '.\Cpipos.WindowsRuntime.exe --printer MTP-II' -ForegroundColor White
