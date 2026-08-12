param(
    [string]$Repository = "sstdevelopaminno/CpIPOS",
    [string]$OutputDirectory = (Join-Path $env:USERPROFILE "CpIPOS-Signing"),
    [switch]$ConfigureGitHub
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function New-HexSecret {
    param([int]$ByteCount = 32)

    $buffer = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    }
    finally {
        $rng.Dispose()
    }

    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$InstallHint = ""
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        $suffix = if ($InstallHint) { " $InstallHint" } else { "" }
        throw "Required command '$Name' was not found.$suffix"
    }
    return $command
}

$keytool = Require-Command -Name "keytool" -InstallHint "Install JDK 17 (Android Studio JBR is also acceptable) and reopen PowerShell."
$gh = $null

# If automatic GitHub secret configuration was requested, prove the CLI and
# authentication are ready before a permanent signing identity is created.
# This prevents a half-completed setup caused only by a missing/unauthed gh CLI.
if ($ConfigureGitHub) {
    $gh = Require-Command -Name "gh" -InstallHint "Install GitHub CLI, run 'gh auth login', then execute this command again."
    & $gh.Source auth status
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI is not authenticated. Run 'gh auth login' and execute this command again. No signing key has been created yet."
    }
}

if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}

$keystorePath = Join-Path $OutputDirectory "cpipos-android-release.jks"
$secretExportPath = Join-Path $OutputDirectory "github-actions-secrets.txt"
$alias = "cpipos-pos-release"

if (Test-Path -LiteralPath $keystorePath) {
    throw "Refusing to overwrite existing stable keystore: $keystorePath. Preserve the existing key and reuse it for every future CpIPOS Android release."
}

$password = New-HexSecret -ByteCount 32
$dname = "CN=CpIPOS Android POS, OU=POS Runtime, O=CpIPOS, L=Bangkok, ST=Bangkok, C=TH"

Write-Host "Creating permanent CpIPOS Android release signing key..."
& $keytool.Source `
    -genkeypair `
    -v `
    -keystore $keystorePath `
    -storetype PKCS12 `
    -alias $alias `
    -keyalg RSA `
    -keysize 4096 `
    -validity 10000 `
    -storepass $password `
    -keypass $password `
    -dname $dname

if ($LASTEXITCODE -ne 0) {
    throw "keytool failed while creating the release keystore."
}

$listing = (& $keytool.Source -list -v -keystore $keystorePath -storepass $password -alias $alias 2>$null | Out-String)
$shaMatch = [regex]::Match($listing, "SHA256:\s*([0-9A-F:]+)", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
if (-not $shaMatch.Success) {
    throw "Could not read SHA-256 certificate fingerprint from the generated keystore."
}

$fingerprint = $shaMatch.Groups[1].Value.Replace(":", "").ToLowerInvariant()
$keystoreBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath))

$secretExport = @"
# CpIPOS Android stable signing material - KEEP PRIVATE
# Generated locally. Never commit this file or the .jks file to Git.
ANDROID_SIGNING_KEYSTORE_BASE64=$keystoreBase64
ANDROID_SIGNING_STORE_PASSWORD=$password
ANDROID_SIGNING_KEY_ALIAS=$alias
ANDROID_SIGNING_KEY_PASSWORD=$password
ANDROID_SIGNING_CERT_SHA256=$fingerprint
"@

[IO.File]::WriteAllText($secretExportPath, $secretExport, [Text.Encoding]::UTF8)

if ($ConfigureGitHub) {
    Write-Host "Uploading the four private signing values to GitHub Actions repository secrets..."

    $keystoreBase64 | & $gh.Source secret set ANDROID_SIGNING_KEYSTORE_BASE64 --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw "Failed to set ANDROID_SIGNING_KEYSTORE_BASE64. The generated files remain in $OutputDirectory for manual recovery." }

    $password | & $gh.Source secret set ANDROID_SIGNING_STORE_PASSWORD --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw "Failed to set ANDROID_SIGNING_STORE_PASSWORD. The generated files remain in $OutputDirectory for manual recovery." }

    $alias | & $gh.Source secret set ANDROID_SIGNING_KEY_ALIAS --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw "Failed to set ANDROID_SIGNING_KEY_ALIAS. The generated files remain in $OutputDirectory for manual recovery." }

    $password | & $gh.Source secret set ANDROID_SIGNING_KEY_PASSWORD --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw "Failed to set ANDROID_SIGNING_KEY_PASSWORD. The generated files remain in $OutputDirectory for manual recovery." }

    Write-Host "GitHub Actions signing secrets configured for $Repository."
}

Write-Host ""
Write-Host "Stable keystore created: $keystorePath"
Write-Host "Private secret export:    $secretExportPath"
Write-Host "Certificate SHA-256:      $fingerprint"
Write-Host ""
Write-Host "IMPORTANT:"
Write-Host "1. Back up cpipos-android-release.jks offline. Losing it prevents future in-place Android upgrades."
Write-Host "2. Never commit the .jks file or github-actions-secrets.txt."
Write-Host "3. If -ConfigureGitHub was not used, add the four ANDROID_SIGNING_* values from github-actions-secrets.txt to GitHub Actions Secrets manually."
Write-Host "4. Send only the Certificate SHA-256 value for the workflow fingerprint update. Do not send the keystore or passwords."
