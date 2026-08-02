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

function Get-DotnetSdkExe {
  $candidates = @(
    "C:\Program Files\dotnet\dotnet.exe",
    "$env:ProgramFiles\dotnet\dotnet.exe",
    "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe"
  )

  $pathDotnet = Get-Command dotnet -ErrorAction SilentlyContinue
  if ($pathDotnet -and $pathDotnet.Source) {
    $candidates += $pathDotnet.Source
  }

  # Keep x86 as a last resort only. It commonly contains runtime without SDK.
  $candidates += @(
    "${env:ProgramFiles(x86)}\dotnet\dotnet.exe"
  )

  foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (!(Test-Path $candidate)) { continue }
    $sdks = & $candidate --list-sdks 2>$null
    if ($LASTEXITCODE -eq 0 -and ($sdks | Select-String -Pattern "^8\." -Quiet)) {
      return [pscustomobject]@{
        Exe = $candidate
        Sdks = ($sdks -join "`n")
      }
    }
  }

  return $null
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

Write-Step "Checking .NET SDK"
$dotnetInfo = Get-DotnetSdkExe
if (!$dotnetInfo) {
  throw "No .NET 8 SDK was found. Install .NET 8 SDK first, then restart VS Code/PowerShell. Expected path: C:\Program Files\dotnet\dotnet.exe"
}
$dotnetExe = $dotnetInfo.Exe
Write-Host "dotnet: $dotnetExe" -ForegroundColor Green
Write-Host $dotnetInfo.Sdks -ForegroundColor Green

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
& $dotnetExe @publishArgs

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
