@echo off
title TINY TOADS - Servidor Local
echo ====================================================
echo   TINY TOADS - Iniciando en tu computadora...
echo ====================================================

where node >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Node.js detectado. Abriendo http://localhost:8080 ...
    start "" "http://localhost:8080"
    node server.mjs
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Python detectado. Abriendo http://localhost:8080 ...
    start "" "http://localhost:8080"
    python -m http.server 8080
    goto :eof
)

echo [INFO] No se detecto Node ni Python. Abriendo index.html directamente...
start "" "%~dp0index.html"
