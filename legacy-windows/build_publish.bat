@echo off
setlocal EnableExtensions
REM PDF Studio - self-contained single-file Windows x64 build.
REM Requires the .NET 8 SDK on the BUILD MACHINE only.

where dotnet >nul 2>nul
if errorlevel 1 (
    echo ERROR: dotnet was not found on PATH.
    echo Install the .NET 8 SDK from https://dotnet.microsoft.com/download/dotnet/8.0
    goto :fail_end
)

cd /d "%~dp0"

echo Closing any running PdfStudio.exe...
taskkill /f /im PdfStudio.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo Cleaning previous Release/publish output...
if exist "bin\Release" rmdir /s /q "bin\Release"
if exist "obj\Release" rmdir /s /q "obj\Release"
if exist "publish" rmdir /s /q "publish"

call :publish_with_retry "PdfStudio.exe"
if errorlevel 1 goto :fail_end

call :sign_outputs
if errorlevel 1 goto :fail_end

echo.
echo ============================================================
echo PDF Studio build complete.
echo Output: %~dp0publish\PdfStudio.exe
echo Self-contained: YES
echo Runtime: win-x64
echo Single-file: YES (pdfium.dll and libSkiaSharp.dll are bundled inside the exe - ship only PdfStudio.exe)
echo ============================================================
exit /b 0

:fail_end
echo.
echo PDF Studio build failed. Review the compiler output above.
pause
exit /b 1

:publish_with_retry
set "PUBLISH_TARGET_NAME=%~1"
echo Publishing PdfStudio.exe (self-contained, single file)...
dotnet publish PdfStudioCS.csproj -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true ^
  -p:IncludeNativeLibrariesForSelfExtract=true ^
  -p:EnableCompressionInSingleFile=false ^
  -o "%~dp0publish"
if not errorlevel 1 exit /b 0

echo.
echo First publish failed. Closing PdfStudio.exe and retrying once...
taskkill /f /im "%PUBLISH_TARGET_NAME%" >nul 2>&1
timeout /t 3 /nobreak >nul

dotnet publish PdfStudioCS.csproj -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true ^
  -p:IncludeNativeLibrariesForSelfExtract=true ^
  -p:EnableCompressionInSingleFile=false ^
  -o "%~dp0publish"
if not errorlevel 1 exit /b 0

exit /b 1

:sign_outputs
REM Authenticode-sign the exe. Settings come from signing\signing.config.bat or environment variables (see signing\README.md).
if exist "%~dp0signing\signing.config.bat" call "%~dp0signing\signing.config.bat"
echo.
echo Signing publish\PdfStudio.exe...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0signing\sign.ps1" -Path "%~dp0publish\PdfStudio.exe"
if errorlevel 1 exit /b 1
exit /b 0
