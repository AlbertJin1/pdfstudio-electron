@echo off
setlocal EnableExtensions
REM PDF Studio - build the release exe and get it ready to upload to the monitor's "Releases" page.
REM Usage:   release.bat
REM          Builds the exe, then uploads it to the monitor through ngrok together with this version's CHANGELOG.md notes
REM          (publish_to_monitor.ps1). NEW version = uploaded; same version but a changed exe = overwritten; identical = skipped.
REM          release.bat noupload   builds only.     release.bat -Force   uploads even if the monitor has the identical exe.
REM          The monitor reads the version out of the exe itself; installed copies offer the update on their next start.

set "MONITOR=https://pdfstudio.shares.zrok.io/pdfstudio-monitor/releases.php"
cd /d "%~dp0"

call "%~dp0build_publish.bat"
if errorlevel 1 exit /b 1

echo.
powershell -NoProfile -Command "$e=(Get-Item 'publish\PdfStudio.exe').VersionInfo; $p=([xml](Get-Content -Raw 'PdfStudioCS.csproj')).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1; Write-Host ('Version inside the exe : ' + $e.FileVersion + '   (this is what the monitor will read)'); Write-Host ('<Version> in csproj    : ' + $p); if (([version]$e.FileVersion).ToString(3) -ne ([version]$p).ToString(3)) { Write-Host 'WARNING: they differ. Set <Version> and <FileVersion> to the same number in PdfStudioCS.csproj and build again.' -ForegroundColor Yellow }"

echo.
if /i "%~1"=="noupload" (
    echo Skipping the upload ^(noupload^). Upload %~dp0publish\PdfStudio.exe at %MONITOR% yourself.
    explorer /select,"%~dp0publish\PdfStudio.exe"
    exit /b 0
)

echo ============================================================
echo Uploading to the PDF Studio Monitor ^(with the release notes from CHANGELOG.md^)...
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish_to_monitor.ps1" %*
if errorlevel 1 (
    echo.
    echo The exe was built but NOT uploaded. Check that serve.bat and ngrok are running, then run:
    echo     powershell -ExecutionPolicy Bypass -File publish_to_monitor.ps1
    echo or upload %~dp0publish\PdfStudio.exe by hand at %MONITOR%
    explorer /select,"%~dp0publish\PdfStudio.exe"
    pause
    exit /b 1
)

echo.
echo Release page: %MONITOR%
exit /b 0
