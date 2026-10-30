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
    echo.
    echo [!] Python não encontrado no PATH do Windows.
    echo Baixe e instale o Python em https://www.python.org/
    echo IMPORTANTE: Na primeira tela do instalador do Python, MARQUE:
    echo   [X] Add Python to PATH (Adicionar Python ao PATH)
    echo.
    pause
    exit /b 1
)

echo [✓] Python localizado com sucesso!
echo.
echo [2/3] Localizando o servidor ponte GhostLens...
cd /d "%~dp0"

set "TARGET_SCRIPT="
if exist "%~dp0daemon\servidor_ponte_local.py" (
    set "TARGET_SCRIPT=%~dp0daemon\servidor_ponte_local.py"
) else if exist "%~dp0servidor_ponte_local.py" (
    set "TARGET_SCRIPT=%~dp0servidor_ponte_local.py"
)

if not defined TARGET_SCRIPT (
    echo [!] Arquivo servidor_ponte_local.py não encontrado nesta pasta.
    echo Certifique-se de EXTRAIR todo o arquivo .ZIP antes de executar!
    pause
    exit /b 1
)

echo [✓] Servidor localizado: "%TARGET_SCRIPT%"
echo [✓] Iniciando motor GhostStealth Bridge (Porta 4444)...
start "GhostLens Bridge Daemon" /B python "%TARGET_SCRIPT%"

timeout /t 2 >nul

echo.
echo [3/3] Abrindo o GhostLens Studio no seu navegador...
start https://ghostlens.cloud/studio

echo.
echo ==========================================================
echo   ✓ GHOSTLENS SUITE PRONTO PARA OPERAR!
echo   Mantenha esta janela aberta enquanto utiliza o GhostLens.
echo ==========================================================
pause
