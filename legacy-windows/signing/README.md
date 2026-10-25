# Signing PDF Studio

`build_publish.bat` (and therefore `release.bat`) signs `publish\PdfStudio.exe` right after `dotnet publish`
using `signing\sign.ps1` (SHA-256 signature plus an RFC 3161 timestamp, so it stays valid after the certificate expires).

## One-time setup
1. Install the **Windows SDK Signing Tools for Desktop Apps** (provides `signtool.exe`).
2. Copy `signing.config.example.bat` to `signing.config.bat` and fill in ONE method (store thumbprint, .pfx, or Azure Trusted Signing).
3. Run `build_publish.bat`. The log ends with the signer, thumbprint, timestamp and status. Set `SIGN_REQUIRED=1` to make an unsigned build fail instead of only warning.

## Which certificate?
| Option | Removes SmartScreen / AV warnings on other PCs? | Notes |
|---|---|---|
| Self-signed (`create_test_certificate.ps1`) | **No** | Only for testing the pipeline. Add `-Trust` to trust it on your own PC. |
| Code-signing certificate from a public CA (Sectigo, DigiCert, SSL.com, ...) | Yes, reputation builds over time | Private key must be on hardware/cloud HSM under current CA rules. Use `SIGN_THUMBPRINT` or the CA's tool. |
| Azure Trusted Signing | Yes, reputation builds over time | Cheap monthly subscription, no hardware token. Use method 3. |

Never commit `.pfx` files or `signing.config.bat` (both are in `.gitignore`).
