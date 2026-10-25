<#
 PDF Studio - Authenticode signing step, called by build_publish.bat after "dotnet publish".

 Configure ONE of these methods (environment variables, or signing\signing.config.bat which the build loads):
   1. PFX file ........ SIGN_PFX=C:\path\cert.pfx   SIGN_PFX_PASSWORD=...
   2. Certificate store SIGN_THUMBPRINT=<SHA1 thumbprint of a code-signing cert in CurrentUser\My>
   3. Azure Trusted Signing: SIGN_AZURE_DLIB=<path to Azure.CodeSigning.Dlib.dll>  SIGN_AZURE_METADATA=<path to metadata.json>
 Optional:
   SIGN_TIMESTAMP=<RFC 3161 server>   (default http://timestamp.digicert.com, with fallbacks)
   SIGN_REQUIRED=1                    (fail the build when nothing is configured; default is to warn and continue unsigned)
#>
param([Parameter(Mandatory = $true)][string[]]$Path)

$ErrorActionPreference = 'Stop'
function Fail([string]$m) { Write-Host ("SIGNING FAILED: " + $m) -ForegroundColor Red; exit 1 }

$pfx = $env:SIGN_PFX; $pfxPw = $env:SIGN_PFX_PASSWORD; $thumb = $env:SIGN_THUMBPRINT
$dlib = $env:SIGN_AZURE_DLIB; $meta = $env:SIGN_AZURE_METADATA
$required = ($env:SIGN_REQUIRED -eq '1')

$method = ''
if ($dlib -and $meta) { $method = 'azure' }
elseif ($pfx) { $method = 'pfx' }
elseif ($thumb) { $method = 'store' }

if (-not $method) {
    if ($required) { Fail 'SIGN_REQUIRED=1 but no certificate is configured (see signing\README.md).' }
    Write-Host 'WARNING: no signing certificate configured - the build is UNSIGNED. See signing\README.md.' -ForegroundColor Yellow
    exit 0
}

# ---- locate signtool.exe (Windows SDK) ----
$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $signtool) {
    $roots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ }
    $found = foreach ($r in $roots) { Get-ChildItem -Path (Join-Path $r 'Windows Kits\10\bin') -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } }
    $signtool = $found | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) { Fail 'signtool.exe not found. Install the "Windows SDK Signing Tools for Desktop Apps" (Visual Studio Installer or the Windows 10/11 SDK).' }
Write-Host ("Using signtool: " + $signtool)

# ---- certificate arguments ----
$certArgs = @()
switch ($method) {
    'pfx' {
        if (-not (Test-Path -LiteralPath $pfx)) { Fail ("SIGN_PFX file not found: " + $pfx) }
        $certArgs = @('/f', $pfx)
        if ($pfxPw) { $certArgs += @('/p', $pfxPw) }
    }
    'store' { $certArgs = @('/sha1', $thumb) }
    'azure' {
        if (-not (Test-Path -LiteralPath $dlib)) { Fail ("SIGN_AZURE_DLIB not found: " + $dlib) }
        if (-not (Test-Path -LiteralPath $meta)) { Fail ("SIGN_AZURE_METADATA not found: " + $meta) }
        $certArgs = @('/dlib', $dlib, '/dmdf', $meta)
    }
}

$stamps = @()
if ($env:SIGN_TIMESTAMP) { $stamps += $env:SIGN_TIMESTAMP }
$stamps += @('http://timestamp.digicert.com', 'http://timestamp.sectigo.com', 'http://timestamp.globalsign.com/tsa/r6advanced1')

foreach ($file in $Path) {
    if (-not (Test-Path -LiteralPath $file)) { Fail ("file to sign not found: " + $file) }
    Write-Host ("Signing " + $file + "  (method: " + $method + ")")
    $ok = $false
    foreach ($ts in $stamps) {
        & $signtool sign /fd sha256 /td sha256 /tr $ts /d 'PDF Studio' @certArgs $file
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        Write-Host ("  signing with timestamp server " + $ts + " failed, trying the next one...") -ForegroundColor Yellow
    }
    if (-not $ok) { Fail ("signtool could not sign " + $file) }

    $sig = Get-AuthenticodeSignature -LiteralPath $file
    if (-not $sig.SignerCertificate) { Fail ("no signature found on " + $file + " after signing") }
    Write-Host ("  signer     : " + $sig.SignerCertificate.Subject)
    Write-Host ("  thumbprint : " + $sig.SignerCertificate.Thumbprint)
    Write-Host ("  timestamp  : " + $(if ($sig.TimeStamperCertificate) { 'yes' } else { 'NO' }))
    Write-Host ("  status     : " + $sig.Status)
    if ($sig.Status -ne 'Valid') {
        Write-Host '  NOTE: the signature is present but this PC does not trust the certificate (normal for a self-signed test certificate). A certificate from a public CA shows Valid.' -ForegroundColor Yellow
    }
}
Write-Host 'Signing complete.' -ForegroundColor Green
exit 0
