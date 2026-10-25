@echo off
setlocal EnableExtensions
REM PDF Studio - single-file portable Windows x64 build.
REM Requires Node.js LTS + npm on the BUILD MACHINE only. Output: publish\PdfStudio.exe - ONE portable file, no installer.

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: node was not found on PATH.
    echo Install Node.js LTS from https://nodejs.org/
    goto :fail_end
)
where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm was not found on PATH.
    goto :fail_end
)

cd /d "%~dp0"

echo Closing any running PdfStudio.exe...
taskkill /f /im PdfStudio.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo Cleaning previous build output...
if exist "dist" rmdir /s /q "dist"
if exist "publish" rmdir /s /q "publish"

echo.
echo Installing project dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo ERROR: npm install failed. Check your internet connection and the npm output above.
    goto :fail_end
)

call :publish_with_retry "PdfStudio.exe"
if errorlevel 1 goto :fail_end

call :sign_outputs
if errorlevel 1 goto :fail_end

echo.
echo ============================================================
echo PDF Studio build complete.
echo Output: %~dp0publish\PdfStudio.exe
echo Portable: YES ^(no installer, no installation, no administrator permission^)
echo Runtime: win-x64
echo Single-file: YES ^(ship only PdfStudio.exe; publish\ contains nothing else^)
echo ============================================================
exit /b 0

:fail_end
echo.
echo PDF Studio build failed. Review the output above.
echo TIP: "Cannot create symbolic link" / "required privilege is not held" means Windows Developer Mode
echo      ^(Settings ^> System ^> For developers^) is off - turn it on, or run this once as Administrator.
pause
exit /b 1

:publish_with_retry
set "PUBLISH_TARGET_NAME=%~1"
echo Publishing PdfStudio.exe ^(portable, single file^)...
call npm run build:win
if not errorlevel 1 exit /b 0

echo.
echo First publish failed. Closing PdfStudio.exe and retrying once...
taskkill /f /im "%PUBLISH_TARGET_NAME%" >nul 2>&1
timeout /t 3 /nobreak >nul

call npm run build:win
if not errorlevel 1 exit /b 0

exit /b 1

:sign_outputs
REM Authenticode-sign the exe. Settings come from signing\signing.config.bat or environment variables (see signing\README.md).
set "SIGN_DIR=%~dp0signing"
if not exist "%SIGN_DIR%\sign.ps1" (
    echo.
    echo NOTE: signing\sign.ps1 was not found - publish\PdfStudio.exe is left UNSIGNED.
    exit /b 0
)
if exist "%SIGN_DIR%\signing.config.bat" call "%SIGN_DIR%\signing.config.bat"
echo.
echo Signing publish\PdfStudio.exe...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SIGN_DIR%\sign.ps1" -Path "%~dp0publish\PdfStudio.exe"
if errorlevel 1 exit /b 1
exit /b 0
