@echo off
setlocal enabledelayedexpansion
title ForgeAI - running
cd /d "%~dp0"

echo.
echo  ============================================
echo    ForgeAI is starting...
echo  ============================================
echo.

rem ---- Checks ----
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js not found. Run setup.bat after installing Node.js 22+.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] npm not found.
  pause
  exit /b 1
)
if not exist ".env" (
  echo  [!] No .env found - running setup first...
  call setup.bat
)
if not exist "node_modules\express" (
  echo  [!] Dependencies missing - installing...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

rem ---- Migrations (idempotent) ----
call npm run migrate >nul 2>nul

echo.
echo   Frontend  -^>  http://localhost:3000
echo   Backend   -^>  http://localhost:8000/api
echo.
echo   Press Ctrl+C to stop both servers.
echo.

rem ---- Run dev launcher (keeps this window alive, shows both logs) ----
node scripts\dev.mjs
set EXITCODE=%errorlevel%
if not "%EXITCODE%"=="0" (
  echo.
  echo  [ERROR] ForgeAI exited with code %EXITCODE%. The window stays open so you can read the log.
  pause
)
endlocal
