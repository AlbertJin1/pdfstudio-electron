@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ============================================================
echo PDF Studio 3 - Portable Windows build
echo ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not on PATH.
  echo Install a supported Node.js LTS release and reopen this terminal.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or is not on PATH.
  pause
  exit /b 1
)
echo.
echo Installing project dependencies...
call npm install
if errorlevel 1 (
  echo ERROR: npm install failed. Check your internet connection and npm error output.
  pause
  exit /b 1
)
echo.
echo Building the no-install portable Windows EXE (no setup installer)...
call npm run build:win
if errorlevel 1 (
  echo ERROR: Build failed. Review the messages above.
  pause
  exit /b 1
)
echo.
for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%V"
echo Build completed. Portable output should be in release\PDF-Studio-%APP_VERSION%-Portable-x64.exe
echo No installation or administrator permission is required to run this portable application.
pause
