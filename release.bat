@echo off
setlocal EnableExtensions
REM PDF Studio - build the release exe and get it ready to upload to the monitor's "Releases" page.
REM Usage:   release.bat
REM          Builds the exe, then uploads it to the monitor through publish_to_monitor.ps1 together with this version's
REM          CHANGELOG.md notes. NEW version = uploaded; same version but a changed exe = overwritten; identical = skipped.
REM          release.bat noupload   builds only.     release.bat -Force   uploads even if the monitor has the identical exe.
REM          The monitor reads the version out of the exe itself; installed copies offer the update on their next start.

set "MONITOR=https://pdfstudio.shares.zrok.io/pdfstudio-monitor/releases.php"
cd /d "%~dp0"

set "PUBLISHER=%~dp0publish_to_monitor.ps1"
set "CHANGELOG=%~dp0CHANGELOG.md"

call "%~dp0build_publish.bat"
if errorlevel 1 exit /b 1

echo.
powershell -NoProfile -Command "$e=(Get-Item 'publish\PdfStudio.exe').VersionInfo; $p=(Get-Content -Raw 'package.json' | ConvertFrom-Json).version; Write-Host ('Version inside the exe : ' + $e.FileVersion + '   (this is what the monitor will read)'); Write-Host ('version in package.json: ' + $p); if ($e.ProductName -ne 'PDF Studio') { Write-Host ('WARNING: ProductName is ''' + $e.ProductName + ''' - the monitor expects ''PDF Studio''.') -ForegroundColor Yellow }; if (([version]$e.FileVersion).ToString(3) -ne ([version]$p).ToString(3)) { Write-Host 'WARNING: they differ. Set the version in package.json and build again.' -ForegroundColor Yellow }"

echo.
if /i "%~1"=="noupload" (
    echo Skipping the upload ^(noupload^). Upload %~dp0publish\PdfStudio.exe at %MONITOR% yourself.
    explorer /select,"%~dp0publish\PdfStudio.exe"
    exit /b 0
)

if not exist "%PUBLISHER%" (
    echo ERROR: publish_to_monitor.ps1 was not found.
    goto :upload_failed
)
if not exist "%CHANGELOG%" (
    echo ERROR: CHANGELOG.md was not found.
    goto :upload_failed
)

echo ============================================================
echo Uploading to the PDF Studio Monitor ^(with the release notes from CHANGELOG.md^)...
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%PUBLISHER%" -ExePath "%~dp0publish\PdfStudio.exe" -Changelog "%CHANGELOG%" %*
if errorlevel 1 goto :upload_failed

echo.
echo Release page: %MONITOR%
exit /b 0

:upload_failed
echo.
echo The exe was built but NOT uploaded. Check that serve.bat and the tunnel are running, then run:
echo     powershell -ExecutionPolicy Bypass -File "%PUBLISHER%" -ExePath "%~dp0publish\PdfStudio.exe" -Changelog "%CHANGELOG%"
echo or upload %~dp0publish\PdfStudio.exe by hand at %MONITOR%
explorer /select,"%~dp0publish\PdfStudio.exe"
pause
exit /b 1
