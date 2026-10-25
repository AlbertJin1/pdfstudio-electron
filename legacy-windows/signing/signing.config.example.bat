@echo off
REM Copy this file to  signing\signing.config.bat  (that file is git-ignored) and fill in ONE method.
REM build_publish.bat loads it automatically before signing.

REM --- Method 1: certificate in the Windows certificate store (CurrentUser\My) ---
REM set "SIGN_THUMBPRINT=0123456789ABCDEF0123456789ABCDEF01234567"

REM --- Method 2: .pfx file ---
REM set "SIGN_PFX=C:\certs\my-code-signing.pfx"
REM set "SIGN_PFX_PASSWORD=your-password"

REM --- Method 3: Azure Trusted Signing ---
REM set "SIGN_AZURE_DLIB=C:\tools\azure-trusted-signing\bin\x64\Azure.CodeSigning.Dlib.dll"
REM set "SIGN_AZURE_METADATA=C:\tools\azure-trusted-signing\metadata.json"

REM --- Optional ---
REM set "SIGN_TIMESTAMP=http://timestamp.digicert.com"
REM set "SIGN_REQUIRED=1"
