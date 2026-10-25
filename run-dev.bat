@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  echo Dependencies have not been installed yet. Run build_publish.bat once or run npm install.
  pause
  exit /b 1
)
call npm run dev
