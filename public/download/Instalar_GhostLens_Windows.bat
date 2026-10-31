@echo off
setlocal EnableDelayedExpansion
title GhostLens Enterprise Suite
chcp 65001 >nul
cls

echo ==========================================================
echo   GHOSTLENS ENTERPRISE SUITE - WINDOWS 10 / 11
echo ==========================================================
echo.
echo [1/3] Verificando Python no sistema...

set "PY_BIN="

:: 1. Testa 'python' no PATH
python --version >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    set "PY_BIN=python"
    goto :PYTHON_READY
)

:: 2. Testa 'py' launcher
py --version >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    set "PY_BIN=py"
    goto :PYTHON_READY
)

:: 3. Procura instalador padrão no perfil do usuário
if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
    set "PY_BIN=%LocalAppData%\Programs\Python\Python311\python.exe"
    goto :PYTHON_READY
)
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set "PY_BIN=%LocalAppData%\Programs\Python\Python312\python.exe"
    goto :PYTHON_READY
)
if exist "%LocalAppData%\Programs\Python\Python310\python.exe" (
    set "PY_BIN=%LocalAppData%\Programs\Python\Python310\python.exe"
    goto :PYTHON_READY
)

:: 4. Procura em Program Files
if exist "%ProgramFiles%\Python311\python.exe" (
    set "PY_BIN=%ProgramFiles%\Python311\python.exe"
    goto :PYTHON_READY
)
if exist "%ProgramFiles%\Python312\python.exe" (
    set "PY_BIN=%ProgramFiles%\Python312\python.exe"
    goto :PYTHON_READY
)

:: Se não encontrou, baixa e instala automaticamente
echo.
echo [!] Python nao localizado no computador.
echo [*] Baixando instalador oficial do Python 3.11...
echo [*] Aguarde alguns instantes (download de ~25 MB)...
echo.

set "INSTALLER=%TEMP%\python_setup.exe"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', '%INSTALLER%')"

if not exist "%INSTALLER%" (
    echo [!] Falha ao baixar o Python automaticamente.
    echo Baixe manualmente em https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [*] Instalando Python silenciosamente e configurando PATH...
"%INSTALLER%" /passive PrependPath=1 Include_pip=1
timeout /t 5 >nul
del "%INSTALLER%" >nul 2>&1

:: Testa novamente
python --version >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    set "PY_BIN=python"
    goto :PYTHON_READY
)

if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
    set "PY_BIN=%LocalAppData%\Programs\Python\Python311\python.exe"
    goto :PYTHON_READY
)

set "PY_BIN=python"

:PYTHON_READY
echo [✓] Python pronto: !PY_BIN!
echo.

echo [2/3] Localizando servidor ponte GhostLens...
set "CURRENT_DIR=%~dp0"
cd /d "%CURRENT_DIR%"

set "SCRIPT_PATH="
if exist "%CURRENT_DIR%daemon\servidor_ponte_local.py" (
    set "SCRIPT_PATH=%CURRENT_DIR%daemon\servidor_ponte_local.py"
) else if exist "%CURRENT_DIR%servidor_ponte_local.py" (
    set "SCRIPT_PATH=%CURRENT_DIR%servidor_ponte_local.py"
)

if not defined SCRIPT_PATH (
    echo.
    echo [!] ERRO: Arquivo servidor_ponte_local.py nao encontrado!
    echo Certifique-se de EXTRAIR a pasta .ZIP antes de executar.
    echo.
    pause
    exit /b 1
)

echo [✓] Arquivo localizado com sucesso!
echo.

echo [3/3] Abrindo GhostLens Studio...
start https://ghostlens.cloud/studio

echo.
echo ==========================================================
echo   🚀 MOTOR GHOSTLENS ATIVO (PORTA 4444)
echo   Mantenha esta janela aberta enquanto utiliza o sistema.
echo ==========================================================
echo.

"!PY_BIN!" "!SCRIPT_PATH!"

echo.
echo ==========================================================
echo [!] O servidor foi finalizado.
echo ==========================================================
pause
