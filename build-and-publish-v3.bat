@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ============================================================
echo PDF Studio Version 3 - portable release
echo ============================================================
echo For reliable automatic upgrades from protected legacy folders, first publish and test the patched C# bridge (2.8.15).
echo The Monitor must also expose the server-enforced bridge gate before Version 3 can be published.
echo.
if not exist "%~dp0scripts\test-monitor-v3-rollout.ps1" (
  echo ERROR: Safe-rollout preflight script is missing.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-monitor-v3-rollout.ps1"
if errorlevel 1 (
  echo ERROR: Fix the Monitor rollout policy / bridge release before building or publishing Version 3.
  pause
  exit /b 1
)
echo.
choice /c YN /m "Confirm the 2.8.15 migration bridge has been tested on an older client"
if errorlevel 2 exit /b 1
call "%~dp0build-windows.bat"
if errorlevel 1 exit /b 1
call "%~dp0publish-v3-portable-to-monitor.bat" %*
exit /b %ERRORLEVEL%
