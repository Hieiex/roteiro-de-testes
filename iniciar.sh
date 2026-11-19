#!/usr/bin/env bash
# Roteiro: inicia no Mac/Linux. No Windows, use o iniciar.bat.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nao encontrado. Instale em https://nodejs.org e rode de novo."
  exit 1
fi

if [ ! -d node_modules/@playwright ]; then
  echo "Primeira vez: instalando dependencias. Pode levar alguns minutos..."
  npm install || exit 1
fi

echo "Verificando navegador de teste..."
npx playwright install chromium >/dev/null 2>&1

echo
echo "Abrindo o Roteiro em http://127.0.0.1:4173 (Ctrl+C para encerrar)"
( sleep 2; (command -v open >/dev/null && open http://127.0.0.1:4173) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:4173) ) >/dev/null 2>&1 &
node servidor.js
