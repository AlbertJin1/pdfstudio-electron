@echo off
setlocal EnableExtensions
cd /d "%~dp0"
for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%V"
if not defined APP_VERSION (
  echo ERROR: Could not read the app version from package.json. Is Node.js installed?
  pause
  exit /b 1
)
set "PORTABLE=%~dp0release\PDF-Studio-%APP_VERSION%-Portable-x64.exe"
set "PUBLISHER=%~dp0legacy-windows\publish_to_monitor.ps1"
set "CHANGELOG=%~dp0legacy-windows\CHANGELOG.md"

if not exist "%PORTABLE%" (
  echo ERROR: Portable Version 3 EXE was not found:
  echo   %PORTABLE%
  echo Run build-windows.bat first. The build intentionally does NOT create an installer.
  pause
  exit /b 1
)
if not exist "%PUBLISHER%" (
  echo ERROR: Monitor publisher not found: %PUBLISHER%
  pause
  exit /b 1
)
if not exist "%CHANGELOG%" (
  echo ERROR: Versioned release notes not found: %CHANGELOG%
  pause
  exit /b 1
)

if not exist "%~dp0scripts\test-monitor-v3-rollout.ps1" (
  echo ERROR: The safe-rollout preflight script is missing.
  pause
  exit /b 1
)

echo Checking that the Monitor is running the safe-rollout API and the bridge release is available...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-monitor-v3-rollout.ps1"
if errorlevel 1 (
  echo.
  echo ERROR: Version 3 will NOT be published until the Monitor safe-rollout policy and bridge release are verified.
  pause
  exit /b 1
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$e=Get-Item -LiteralPath '%PORTABLE%'; $v=$e.VersionInfo; Write-Host ('Portable EXE: ' + $e.FullName); Write-Host ('File version: ' + $v.FileVersion); Write-Host ('Product name: ' + $v.ProductName); if ($v.ProductName -ne 'PDF Studio') { Write-Error 'The portable EXE ProductName must be PDF Studio so the monitor accepts it.'; exit 1 }; if ([version]$v.FileVersion -lt [version]'3.0.0.0') { Write-Error 'The portable EXE must have FileVersion 3.0.0 or newer.'; exit 1 }"
if errorlevel 1 (
  echo ERROR: The portable executable metadata is not compatible with the monitor. Do not publish it.
  pause
  exit /b 1
)

echo ============================================================
echo Publish PDF Studio Version 3 portable EXE
echo ============================================================
echo This uploads the Electron portable EXE as PdfStudio.exe in the existing monitor release system.
echo No setup installer is produced or uploaded. The server gate routes pre-bridge clients through 2.8.15 first.
echo The preflight has verified the server gate and a bridge-compatible target. Monitor URL/API key come from legacy-windows\Services\UsageTracker.cs or environment variables.
echo.
choice /c YN /m "Confirm uploading the portable PDF Studio 3 EXE to the monitor"
if errorlevel 2 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -File "%PUBLISHER%" -ExePath "%PORTABLE%" -Changelog "%CHANGELOG%" %*
if errorlevel 1 (
  echo.
  echo ERROR: Publishing failed. Review the PowerShell output above.
  pause
  exit /b 1
)
echo.
echo SUCCESS: Portable PDF Studio Version 3 has been published.
echo Existing clients will receive the standalone portable app; no installation is required.
pause
