#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "===================================================="
echo "  🐸 TINY TOADS - Iniciando Servidor Local..."
echo "  👉 Abre en tu navegador: http://localhost:8080"
echo "===================================================="

if command -v node >/dev/null 2>&1; then
  node server.mjs
elif command -v python3 >/dev/null 2>&1; then
  python3 -m http.server 8080
else
  echo "Abriendo index.html..."
  xdg-open index.html 2>/dev/null || open index.html 2>/dev/null || true
fi
