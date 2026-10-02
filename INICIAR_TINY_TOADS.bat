@echo off
title TINY TOADS - servidor local
cd /d "%~dp0"
echo ==========================================
echo   TINY TOADS - demo ficticia (creditos virtuales)
echo   Servidor local en http://localhost:8080
echo   Cierra esta ventana para detenerlo.
echo ==========================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  python -m http.server 8080
  goto :end
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  py -m http.server 8080
  goto :end
)
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  node server.js
  goto :end
)
echo No se encontro Python ni Node.js.
echo Instala Python desde https://www.python.org/downloads/ (marca "Add to PATH")
echo o Node.js desde https://nodejs.org y vuelve a ejecutar este archivo.
pause
:end
