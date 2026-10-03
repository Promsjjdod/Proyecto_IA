@echo off
setlocal enabledelayedexpansion
title ForgeAI - setup
cd /d "%~dp0"

echo.
echo  ============================================
echo    ForgeAI setup   -   Build. Think. Create.
echo  ============================================
echo.

rem ---- 1. Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found in PATH.
  echo          Install Node.js 22 LTS or newer from https://nodejs.org and re-run setup.bat
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo  [ok] Node.js %NODEVER%

rem ---- 2. npm ----
where npm >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] npm was not found. Reinstall Node.js including npm.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('npm -v') do set NPMVER=%%v
echo  [ok] npm %NPMVER%

rem ---- 3. .env ----
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo  [ok] Created .env from .env.example
  powershell -NoProfile -Command "$s=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N'); (Get-Content '.env') -replace 'FORGEAI_SECRET_KEY=change-me-to-a-64-char-hex-string', ('FORGEAI_SECRET_KEY='+$s) | Set-Content '.env'" >nul 2>nul
  echo  [ok] Generated a local FORGEAI_SECRET_KEY
) else (
  echo  [ok] .env already exists - untouched
)

rem ---- 4. Dependencies ----
if not exist "node_modules\express" goto install
if not exist "node_modules\vite" goto install
echo  [ok] Dependencies already installed
goto migrate
:install
echo  ... installing dependencies (first run can take a few minutes)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  [ERROR] npm install failed. Fix the error above and re-run setup.bat
  pause
  exit /b 1
)
echo  [ok] Dependencies installed

rem ---- 5. Runtime folders ----
if not exist "data" mkdir data
if not exist "data\logs" mkdir data\logs
if not exist "uploads" mkdir uploads
if not exist "generated\images" mkdir generated\images
if not exist "generated\videos" mkdir generated\videos

rem ---- 6. Migrations + seed ----
:migrate
echo  ... migrating and seeding the local database
call npm run migrate
if errorlevel 1 (
  echo  [ERROR] Database migration failed.
  pause
  exit /b 1
)
echo  [ok] Database ready

echo.
echo  Setup complete. Start ForgeAI with:   start.bat     (or: npm run dev)
echo  Then open:  http://localhost:3000
echo.
pause
endlocal
