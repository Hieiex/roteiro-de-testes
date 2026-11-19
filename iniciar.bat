@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Roteiro

if not defined PORT set "PORT=4173"

rem ---------- 1. Node.js ----------
where node >nul 2>nul
if not errorlevel 1 goto node_ok

echo Node.js nao encontrado. Tentando instalar automaticamente...
where winget >nul 2>nul
if errorlevel 1 goto node_manual
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
rem O Node recem instalado ainda nao esta no PATH desta janela.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto node_ok

:node_manual
echo.
echo Nao consegui instalar o Node.js sozinho.
echo 1. Instale em https://nodejs.org  escolhendo o botao LTS e deixando as opcoes padrao.
echo 2. Feche esta janela e de duplo clique em iniciar.bat de novo.
pause
exit /b 1

:node_ok
node -e "process.exit(Number(process.versions.node.split('.')[0])<18?1:0)"
if errorlevel 1 (
  echo O Node.js desta maquina e antigo. O Roteiro precisa da versao 18 ou mais nova.
  echo Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)

rem ---------- 2. Dependencias do projeto ----------
if not exist node_modules\@playwright (
  echo Primeira vez: instalando dependencias. Pode levar alguns minutos...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Falha ao instalar as dependencias. Confira a internet ou o proxy da empresa.
    echo Se o problema continuar, envie a mensagem acima para quem cuida do TI.
    pause
    exit /b 1
  )
)

rem ---------- 3. Navegador de teste ----------
echo Verificando o navegador de teste. Na primeira vez baixa cerca de 150 MB...
call npx playwright install chromium
if errorlevel 1 (
  echo.
  echo Nao consegui baixar o navegador de teste.
  echo Sem ele os roteiros nao rodam. Causas comuns: sem internet, proxy ou antivirus bloqueando.
  echo Corrija a rede e abra este arquivo de novo. Se persistir, envie a mensagem acima ao TI.
  pause
  exit /b 1
)

rem ---------- 4. Iniciar ----------
echo.
echo Abrindo o Roteiro em http://127.0.0.1:%PORT%
echo Para encerrar, feche esta janela.
if not defined ROTEIRO_SEM_NAVEGADOR start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%"
node servidor.js
pause
