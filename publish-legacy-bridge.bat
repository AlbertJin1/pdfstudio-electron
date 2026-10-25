@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ============================================================
echo Optional PDF Studio legacy migration bridge - 2.8.15
echo ============================================================
echo This publishes a patched legacy C# updater that can use a LocalAppData portable fallback
echo when the legacy executable folder is protected. It is NOT a requirement for the Version 3 release:
echo the existing EXE update channel publishes the standalone portable PDF Studio 3 launcher.
echo.
call "%~dp0legacy-windows\release.bat" %*
exit /b %ERRORLEVEL%
