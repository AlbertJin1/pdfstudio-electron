<#
 Creates a SELF-SIGNED code-signing certificate so you can test the signing pipeline.
 A self-signed certificate does NOT remove SmartScreen warnings or antivirus false positives on other PCs -
 for that you need a certificate from a public CA (or Azure Trusted Signing). See signing\README.md.

 Usage (PowerShell):   .\signing\create_test_certificate.ps1            creates it and prints the settings to use
                       .\signing\create_test_certificate.ps1 -Trust     also trusts it on THIS PC (asks for confirmation)
#>
param(
    [string]$Subject = 'CN=Jessie Albert Regualos (PDF Studio test certificate)',
    [int]$Years = 3,
    [switch]$Trust
)
$ErrorActionPreference = 'Stop'

$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -KeyAlgorithm RSA -KeyLength 3072 `
    -HashAlgorithm SHA256 -KeyExportPolicy Exportable -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears($Years)

$dir = $PSScriptRoot
$cer = Join-Path $dir 'PdfStudio-test.cer'
$pfx = Join-Path $dir 'PdfStudio-test.pfx'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
$pw = Read-Host -AsSecureString 'Password for the exported .pfx (leave empty to skip the .pfx)'
$havePfx = $pw.Length -gt 0
if ($havePfx) { Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw | Out-Null }

if ($Trust) {
    Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\TrustedPublisher' | Out-Null
    Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null   # Windows shows a confirmation prompt
}

Write-Host ''
Write-Host 'Certificate created.' -ForegroundColor Green
Write-Host ('Thumbprint: ' + $cert.Thumbprint)
Write-Host ''
Write-Host 'Put this in signing\signing.config.bat to sign every build with it:'
Write-Host ('    set "SIGN_THUMBPRINT=' + $cert.Thumbprint + '"')
if ($havePfx) { Write-Host ('  (or use the exported file)  set "SIGN_PFX=' + $pfx + '"  and  set "SIGN_PFX_PASSWORD=<the password you typed>"') }
