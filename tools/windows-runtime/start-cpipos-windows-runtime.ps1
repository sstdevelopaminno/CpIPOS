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

function Write-Info([string]$Message) {
  Write-Host "[CpIPOS Windows Runtime] $Message" -ForegroundColor Cyan
}

function Write-Warn([string]$Message) {
  Write-Host "[CpIPOS Windows Runtime] $Message" -ForegroundColor Yellow
}

function Resolve-PathTemplate([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  return [Environment]::ExpandEnvironmentVariables($Value)
}

function Read-RuntimeConfig([string]$RuntimeDir) {
  $configPath = Join-Path $RuntimeDir "runtime-config.json"
  $examplePath = Join-Path $RuntimeDir "runtime-config.example.json"
  if (Test-Path $configPath) {
    return Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  if (Test-Path $examplePath) {
    return Get-Content -LiteralPath $examplePath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  return [pscustomobject]@{}
}

function Find-BrowserExe([bool]$PreferChrome) {
  $edgeCandidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  )
  $chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )

  $candidates = if ($PreferChrome) { $chromeCandidates + $edgeCandidates } else { $edgeCandidates + $chromeCandidates }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw "ไม่พบ Microsoft Edge หรือ Google Chrome ในเครื่องนี้"
}

function Test-HttpOk([string]$Url) {
  try {
    $result = Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 2
    return $null -ne $result
  } catch {
    return $false
  }
}

function Wait-Bridge([string]$HealthUrl) {
  for ($i = 1; $i -le 20; $i++) {
    if (Test-HttpOk $HealthUrl) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Start-BridgeProcess([string]$RepoRoot, [string]$PrinterName) {
  $bridgeDir = Join-Path $RepoRoot "tools\local-print-bridge-windows"
  $serverPath = Join-Path $bridgeDir "server.mjs"
  if (!(Test-Path $serverPath)) {
    throw "ไม่พบ Local Print Bridge ที่ $serverPath กรุณา pull โค้ดล่าสุดก่อน"
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (!$node) {
    throw "ไม่พบ Node.js กรุณาติดตั้ง Node.js หรือเพิ่ม C:\Program Files\nodejs ใน PATH"
  }

  $envLines = @()
  if (![string]::IsNullOrWhiteSpace($PrinterName)) {
    $escapedPrinter = $PrinterName.Replace("'", "''")
    $envLines += "`$env:CPIPOS_WINDOWS_PRINTER='$escapedPrinter'"
  }
  $envLines += "cd '$($bridgeDir.Replace("'", "''"))'"
  $envLines += "node server.mjs"
  $script = $envLines -join "; "

  Write-Info "กำลังเปิด Local Print Bridge"
  Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $script) -WindowStyle Normal | Out-Null
}

$runtimeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $runtimeDir "..\..")
$config = Read-RuntimeConfig $runtimeDir

if ([string]::IsNullOrWhiteSpace($AppUrl)) {
  $AppUrl = if ($config.app_url) { [string]$config.app_url } else { "https://cp-ipos-web.vercel.app/login/store" }
}
if ([string]::IsNullOrWhiteSpace($WindowsPrinter)) {
  $WindowsPrinter = if ($config.windows_printer) { [string]$config.windows_printer } else { "" }
}

$bridgeHealthUrl = if ($config.bridge_health_url) { [string]$config.bridge_health_url } else { "http://127.0.0.1:3210/health" }
$profileDir = if ($config.profile_dir) { Resolve-PathTemplate ([string]$config.profile_dir) } else { Join-Path $env:LOCALAPPDATA "CpIPOS\WindowsRuntime\BrowserProfile" }
$offlinePage = Join-Path $runtimeDir "offline.html"

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

Write-Info "Repo: $repoRoot"
Write-Info "App URL: $AppUrl"
Write-Info "Browser profile: $profileDir"

if (!$SkipBridge) {
  if (Test-HttpOk $bridgeHealthUrl) {
    Write-Info "Local Print Bridge เปิดอยู่แล้ว: $bridgeHealthUrl"
  } else {
    Start-BridgeProcess -RepoRoot $repoRoot -PrinterName $WindowsPrinter
    if (Wait-Bridge $bridgeHealthUrl) {
      Write-Info "Local Print Bridge พร้อมใช้งาน: $bridgeHealthUrl"
    } else {
      Write-Warn "ยังเช็ก Local Print Bridge ไม่สำเร็จ แต่จะเปิด CpIPOS ต่อ กรุณาดูหน้าต่าง Bridge ว่ามี error หรือไม่"
    }
  }
}

$preferChrome = $UseChrome.IsPresent -or ([string]$config.browser -eq "chrome")
$browserExe = Find-BrowserExe -PreferChrome:$preferChrome
Write-Info "Browser: $browserExe"

$targetUrl = $AppUrl
if (!(Test-HttpOk "https://cp-ipos-web.vercel.app/manifest.webmanifest") -and (Test-Path $offlinePage)) {
  Write-Warn "ยังเช็ก production URL ไม่ได้ จะเปิดหน้า offline fallback ก่อน"
  $targetUrl = (New-Object System.Uri($offlinePage)).AbsoluteUri
}

$args = @(
  "--app=$targetUrl",
  "--user-data-dir=$profileDir",
  "--no-first-run",
  "--disable-translate",
  "--disable-features=Translate,HardwareMediaKeyHandling",
  "--autoplay-policy=no-user-gesture-required"
)

if (!$NoFullscreen) {
  $args += "--start-fullscreen"
}

Write-Info "กำลังเปิด CpIPOS Windows Runtime"
Start-Process -FilePath $browserExe -ArgumentList $args | Out-Null
Write-Info "เสร็จแล้ว"
