# CpIPOS Windows Runtime MVP launcher
# Starts the local print bridge, waits for health, then opens CpIPOS in Edge/Chrome app mode.
# This MVP does not implement the offline sales database or sync queue yet.

[CmdletBinding()]
param(
  [string]$AppUrl,
  [string]$WindowsPrinter,
  [switch]$UseChrome,
  [switch]$NoFullscreen,
  [switch]$SkipBridge
)

$ErrorActionPreference = "Stop"

function Write-Info {
  param([string]$Message)
  Write-Host "[CpIPOS Windows Runtime] $Message" -ForegroundColor Cyan
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[CpIPOS Windows Runtime] $Message" -ForegroundColor Yellow
}

function Resolve-PathTemplate {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  return [Environment]::ExpandEnvironmentVariables($Value)
}

function Read-RuntimeConfig {
  param([string]$RuntimeDir)
  $configPath = Join-Path $RuntimeDir "runtime-config.json"
  $examplePath = Join-Path $RuntimeDir "runtime-config.example.json"
  if (Test-Path -LiteralPath $configPath) {
    return Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  if (Test-Path -LiteralPath $examplePath) {
    return Get-Content -LiteralPath $examplePath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  return [pscustomobject]@{}
}

function Find-BrowserExe {
  param([bool]$PreferChrome)

  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $edgeCandidates = @(
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
  )
  $chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )

  if ($PreferChrome) {
    $candidates = $chromeCandidates + $edgeCandidates
  } else {
    $candidates = $edgeCandidates + $chromeCandidates
  }

  foreach ($candidate in $candidates) {
    if (![string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
  throw "ไม่พบ Microsoft Edge หรือ Google Chrome ในเครื่องนี้"
}

function Test-HttpOk {
  param([string]$Url)
  try {
    $result = Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 2
    return $null -ne $result
  } catch {
    return $false
  }
}

function Wait-Bridge {
  param([string]$HealthUrl)
  for ($i = 1; $i -le 20; $i++) {
    if (Test-HttpOk -Url $HealthUrl) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Start-BridgeProcess {
  param(
    [string]$RepoRoot,
    [string]$PrinterName
  )

  $bridgeDir = Join-Path $RepoRoot "tools\local-print-bridge-windows"
  $serverPath = Join-Path $bridgeDir "server.mjs"
  if (!(Test-Path -LiteralPath $serverPath)) {
    throw "ไม่พบ Local Print Bridge ที่ $serverPath กรุณา pull โค้ดล่าสุดก่อน"
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (!$nodeCommand) {
    throw "ไม่พบ Node.js กรุณาติดตั้ง Node.js หรือเพิ่ม C:\Program Files\nodejs ใน PATH"
  }

  $logDir = Join-Path $env:LOCALAPPDATA "CpIPOS\WindowsRuntime\Logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stdoutLog = Join-Path $logDir "local-print-bridge.out.log"
  $stderrLog = Join-Path $logDir "local-print-bridge.err.log"

  $previousPrinter = $env:CPIPOS_WINDOWS_PRINTER
  try {
    if (![string]::IsNullOrWhiteSpace($PrinterName)) {
      $env:CPIPOS_WINDOWS_PRINTER = $PrinterName
      Write-Info "Printer: $PrinterName"
    }

    Write-Info "กำลังเปิด Local Print Bridge"
    Write-Info "Bridge log: $stdoutLog"
    Start-Process -FilePath $nodeCommand.Source `
      -ArgumentList @("server.mjs") `
      -WorkingDirectory $bridgeDir `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -WindowStyle Hidden | Out-Null
  } finally {
    if ($null -eq $previousPrinter) {
      Remove-Item Env:\CPIPOS_WINDOWS_PRINTER -ErrorAction SilentlyContinue
    } else {
      $env:CPIPOS_WINDOWS_PRINTER = $previousPrinter
    }
  }
}

$runtimeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $runtimeDir "..\..")).Path
$config = Read-RuntimeConfig -RuntimeDir $runtimeDir

if ([string]::IsNullOrWhiteSpace($AppUrl)) {
  if ($config.app_url) {
    $AppUrl = [string]$config.app_url
  } else {
    $AppUrl = "https://cp-ipos-web.vercel.app/login/store"
  }
}

if ([string]::IsNullOrWhiteSpace($WindowsPrinter)) {
  if ($config.windows_printer) {
    $WindowsPrinter = [string]$config.windows_printer
  } else {
    $WindowsPrinter = ""
  }
}

if ($config.bridge_health_url) {
  $bridgeHealthUrl = [string]$config.bridge_health_url
} else {
  $bridgeHealthUrl = "http://127.0.0.1:3210/health"
}

if ($config.profile_dir) {
  $profileDir = Resolve-PathTemplate -Value ([string]$config.profile_dir)
} else {
  $profileDir = Join-Path $env:LOCALAPPDATA "CpIPOS\WindowsRuntime\BrowserProfile"
}

$offlinePage = Join-Path $runtimeDir "offline.html"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

Write-Info "Repo: $repoRoot"
Write-Info "App URL: $AppUrl"
Write-Info "Browser profile: $profileDir"

if (!$SkipBridge) {
  if (Test-HttpOk -Url $bridgeHealthUrl) {
    Write-Info "Local Print Bridge เปิดอยู่แล้ว: $bridgeHealthUrl"
  } else {
    Start-BridgeProcess -RepoRoot $repoRoot -PrinterName $WindowsPrinter
    if (Wait-Bridge -HealthUrl $bridgeHealthUrl) {
      Write-Info "Local Print Bridge พร้อมใช้งาน: $bridgeHealthUrl"
    } else {
      Write-Warn "ยังเช็ก Local Print Bridge ไม่สำเร็จ แต่จะเปิด CpIPOS ต่อ กรุณาดู log ใน %LOCALAPPDATA%\CpIPOS\WindowsRuntime\Logs"
    }
  }
}

$preferChrome = $UseChrome.IsPresent -or ([string]$config.browser -eq "chrome")
$browserExe = Find-BrowserExe -PreferChrome $preferChrome
Write-Info "Browser: $browserExe"

$targetUrl = $AppUrl
if (!(Test-HttpOk -Url "https://cp-ipos-web.vercel.app/manifest.webmanifest") -and (Test-Path -LiteralPath $offlinePage)) {
  Write-Warn "ยังเช็ก production URL ไม่ได้ จะเปิดหน้า offline fallback ก่อน"
  $targetUrl = (New-Object System.Uri($offlinePage)).AbsoluteUri
}

$browserArgs = @(
  "--app=$targetUrl",
  "--user-data-dir=$profileDir",
  "--no-first-run",
  "--disable-translate",
  "--disable-features=Translate,HardwareMediaKeyHandling",
  "--autoplay-policy=no-user-gesture-required"
)

if (!$NoFullscreen) {
  $browserArgs += "--start-fullscreen"
}

Write-Info "กำลังเปิด CpIPOS Windows Runtime"
Start-Process -FilePath $browserExe -ArgumentList $browserArgs | Out-Null
Write-Info "เสร็จแล้ว"
