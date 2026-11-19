@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Roteiro

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)

if not exist node_modules\@playwright (
  echo Primeira vez: instalando dependencias. Pode levar alguns minutos...
  call npm install
  if errorlevel 1 ( echo Falha ao instalar. & pause & exit /b 1 )
)

echo Verificando navegador de teste...
call npx playwright install chromium >nul 2>nul

echo.
echo Abrindo o Roteiro em http://127.0.0.1:4173
echo Feche esta janela para encerrar.
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:4173"
node servidor.js
pause
