@echo off
title GhostLens Enterprise Suite - Setup
chcp 65001 >nul
cls
echo ==========================================================
echo   GHOSTLENS DESKTOP SUITE - INICIALIZADOR WINDOWS 10 / 11
echo ==========================================================
echo [1/3] Verificando ambiente Python...

where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [!] Python nao localizado no PATH do Windows.
    echo Baixe o Python em python.org ou execute a versao standalone.
)

echo [2/3] Iniciando o motor GhostStealth Bridge local (porta 4444)...
cd /d "%~dp0"
if exist "daemon\servidor_ponte_local.py" (
    start /B python daemon\servidor_ponte_local.py
) else if exist "servidor_ponte_local.py" (
    start /B python servidor_ponte_local.py
)

timeout /t 2 >nul

echo [3/3] Abrindo o GhostLens Studio no seu navegador...
start https://ghostlens.cloud/studio

echo ==========================================================
echo   ✓ GHOSTLENS SUITE PRONTO PARA OPERAR!
echo   Mantenha esta janela aberta enquanto utiliza o GhostLens.
echo ==========================================================
pause
