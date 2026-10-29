@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM PDF Studio V3 - build the portable EXE and publish it to the selected Monitor.
REM Usage:
REM   release.bat                    Build, then choose automatic, public, or local Monitor
REM   release.bat auto               Try local Monitor first, then public zrok fallback
REM   release.bat public             Build and publish through public zrok
REM   release.bat local              Build and publish directly to the local Monitor host
REM   release.bat auto -Force        Replace even if the Monitor reports an identical release
REM   release.bat local -NoZip       Upload the raw EXE (compatibility fallback)
REM   release.bat noupload           Build only; do not contact the Monitor
REM   release.bat help               Show this help
REM API key: PDFSTUDIO_MONITOR_KEY, monitor-key.txt, or secure prompt.

cd /d "%~dp0"
if errorlevel 1 (
    echo ERROR: Could not open the V3 project folder.
    exit /b 1
)

set "PUBLIC_BASE=https://pdfstudio.shares.zrok.io/pdfstudio-monitor"
set "LOCAL_BASE=http://192.168.254.110:8080/pdfstudio-monitor"
set "TARGET="
set "FALLBACK_BASE="
set "NOUPLOAD=0"
set "FORCE=0"
set "NOZIP=0"

for %%A in ("%~1" "%~2" "%~3" "%~4") do (
    if /i "%%~A"=="help" goto :usage
    if /i "%%~A"=="/?" goto :usage
    if /i "%%~A"=="public" set "TARGET=public"
    if /i "%%~A"=="zrok" set "TARGET=public"
    if /i "%%~A"=="local" set "TARGET=local"
    if /i "%%~A"=="auto" set "TARGET=auto"
    if /i "%%~A"=="noupload" set "NOUPLOAD=1"
    if /i "%%~A"=="-Force" set "FORCE=1"
    if /i "%%~A"=="-NoZip" set "NOZIP=1"
)

if "%NOUPLOAD%"=="1" goto :build_only
if not defined TARGET goto :choose_target
if /i "%TARGET%"=="public" goto :use_public
if /i "%TARGET%"=="local" goto :use_local
if /i "%TARGET%"=="auto" goto :use_auto
goto :choose_target

:choose_target
echo.
echo ============================================================
echo Choose where to publish this PDF Studio V3 release
echo ============================================================
echo   [1] Public zrok URL  - %PUBLIC_BASE%
echo   [2] Local Monitor    - %LOCAL_BASE%
echo   [3] Automatic        - local first, public fallback
echo.
choice /c 123 /n /m "Select target [1/2/3]: "
if errorlevel 3 goto :use_auto
if errorlevel 2 goto :use_local
goto :use_public

:use_public
set "TARGET=public"
set "MONITOR_BASE=%PUBLIC_BASE%"
set "MONITOR_PAGE=%PUBLIC_BASE%/releases.php"
goto :target_ready

:use_local
set "TARGET=local"
set "MONITOR_BASE=%LOCAL_BASE%"
set "MONITOR_PAGE=%LOCAL_BASE%/releases.php"
echo.
echo WARNING: the local target uses HTTP. Use it only on your trusted private LAN.
goto :target_ready

:use_auto
set "TARGET=auto"
set "MONITOR_BASE=%LOCAL_BASE%"
set "FALLBACK_BASE=%PUBLIC_BASE%"
set "MONITOR_PAGE=%LOCAL_BASE%/releases.php"
echo.
echo Automatic mode tries the local Monitor first and falls back to public zrok if needed.
echo The uploader will report the endpoint that actually accepts the release.
goto :target_ready

:target_ready
echo.
echo Release target : %TARGET%
echo Monitor base   : %MONITOR_BASE%
if defined FALLBACK_BASE echo Fallback base  : %FALLBACK_BASE%
echo Release page   : %MONITOR_PAGE%
if "%NOZIP%"=="1" echo Package mode   : raw EXE ^(-NoZip^)
if "%NOZIP%"=="0" echo Package mode   : compressed ZIP when smaller; raw EXE fallback
echo.
goto :build

:build_only
echo.
echo Build-only mode selected. The Monitor will not be contacted.

:build
call "%~dp0build_publish.bat"
if errorlevel 1 exit /b 1

if not exist "%~dp0publish\PdfStudio.exe" (
    echo ERROR: Build succeeded but publish\PdfStudio.exe was not found.
    exit /b 1
)

set "PDFSTUDIO_RELEASE_EXE=%~dp0publish\PdfStudio.exe"
set "PDFSTUDIO_RELEASE_PACKAGE=%~dp0package.json"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; try { $exe=Get-Item -LiteralPath $env:PDFSTUDIO_RELEASE_EXE; $info=$exe.VersionInfo; $pkg=Get-Content -Raw -LiteralPath $env:PDFSTUDIO_RELEASE_PACKAGE | ConvertFrom-Json; $ev=[regex]::Match([string]$info.FileVersion,'^\s*(\d+\.\d+\.\d+)(?:\.\d+)?\s*$'); if(-not $ev.Success){ throw 'EXE FileVersion is missing or invalid.' }; $ver=$ev.Groups[1].Value; Write-Host ('Product name        : ' + $info.ProductName); Write-Host ('Version inside EXE  : ' + $ver); Write-Host ('package.json version: ' + $pkg.version); if($info.ProductName -ne 'PDF Studio'){ throw ('ProductName must be PDF Studio; found ' + $info.ProductName) }; if($ver -ne ([string]$pkg.version)){ throw 'EXE version and package.json version differ. Do not publish this build.' }; exit 0 } catch { Write-Host ('ERROR: Release metadata validation failed: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 (
    set "PDFSTUDIO_RELEASE_EXE="
    set "PDFSTUDIO_RELEASE_PACKAGE="
    echo ERROR: The release was NOT uploaded.
    exit /b 1
)
set "PDFSTUDIO_RELEASE_EXE="
set "PDFSTUDIO_RELEASE_PACKAGE="

if "%NOUPLOAD%"=="1" (
    echo.
    echo Skipping upload ^(noupload^). Built file: %~dp0publish\PdfStudio.exe
    explorer /select,"%~dp0publish\PdfStudio.exe"
    exit /b 0
)

set "PUBLISHER=%~dp0publish_to_monitor.ps1"
set "CHANGELOG=%~dp0CHANGELOG.md"
if not exist "%PUBLISHER%" (
    echo ERROR: publish_to_monitor.ps1 was not found.
    goto :upload_failed
)
if not exist "%CHANGELOG%" (
    echo ERROR: CHANGELOG.md was not found. Add release notes for the EXE's version.
    goto :upload_failed
)

echo ============================================================
echo Publishing PDF Studio V3 to %MONITOR_BASE%
echo ZIP is uploaded only when it is smaller than the EXE and the Monitor confirms ZIP support.
echo Every uploaded package and the executable inside it are SHA-256 verified.
echo ============================================================
set "PUBLISH_ARGS=-ExePath "%~dp0publish\PdfStudio.exe" -Changelog "%CHANGELOG%" -MonitorUrl "%MONITOR_BASE%" -ApiKeyFile "%~dp0monitor-key.txt""
if defined FALLBACK_BASE set "PUBLISH_ARGS=%PUBLISH_ARGS% -FallbackMonitorUrl "%FALLBACK_BASE%""
if "%FORCE%"=="1" set "PUBLISH_ARGS=%PUBLISH_ARGS% -Force"
if "%NOZIP%"=="1" set "PUBLISH_ARGS=%PUBLISH_ARGS% -NoZip"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PUBLISHER%" %PUBLISH_ARGS%
if errorlevel 1 goto :upload_failed

echo.
echo Release published successfully.
if /i "%TARGET%"=="auto" (
    echo See the successful uploader output above for the Monitor endpoint that accepted the release.
) else (
    echo Release page: %MONITOR_PAGE%
    start "" "%MONITOR_PAGE%"
)
exit /b 0

:upload_failed
echo.
echo The EXE was built but NOT uploaded. Check that the selected Monitor is running and reachable.
echo Selected Monitor: %MONITOR_BASE%
if defined FALLBACK_BASE echo Fallback Monitor: %FALLBACK_BASE%
echo You can retry without rebuilding with:
echo   powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish_to_monitor.ps1" -ExePath "%~dp0publish\PdfStudio.exe" -Changelog "%~dp0CHANGELOG.md" -MonitorUrl "%MONITOR_BASE%" -ApiKeyFile "%~dp0monitor-key.txt"
explorer /select,"%~dp0publish\PdfStudio.exe"
pause
exit /b 1

:usage
echo Usage:
echo   release.bat                    Build and choose a Monitor target
echo   release.bat auto               Local first, public fallback
echo   release.bat public             Build and upload via public zrok
echo   release.bat local              Build and upload to the local Monitor host
echo   release.bat auto -Force        Force upload/replacement
echo   release.bat local -NoZip       Upload raw EXE; skip ZIP compression
echo   release.bat noupload           Build only, no upload
exit /b 0
