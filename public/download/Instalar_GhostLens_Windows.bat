@echo off
title GhostLens Suite & GhostPhone Engine
cls
echo ==========================================================
echo   GHOSTLENS DESKTOP SUITE & GHOSTPHONE - INSTALADOR
echo ==========================================================
echo.
cd /d "%~dp0"

:: Tenta localizar python em ordem
set PY_RUN=
python --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_RUN=python
    goto RUN_SETUP
)

py --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_RUN=py
    goto RUN_SETUP
)

if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python311\python.exe"
    goto RUN_SETUP
)

if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python312\python.exe"
    goto RUN_SETUP
)

if exist "%ProgramFiles%\Python311\python.exe" (
    set PY_RUN="%ProgramFiles%\Python311\python.exe"
    goto RUN_SETUP
)

echo [!] Python nao encontrado no computador.
echo Baixando instalador oficial do Python 3.11...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', '%TEMP%\py_inst.exe')"
if exist "%TEMP%\py_inst.exe" (
    echo Instalando Python automaticamente em segundo plano...
    "%TEMP%\py_inst.exe" /passive PrependPath=1
    del "%TEMP%\py_inst.exe" >nul 2>&1
    set PY_RUN=python
    goto RUN_SETUP
) else (
    echo Falha ao baixar o Python. Baixe em https://www.python.org/downloads/
    pause
    exit /b 1
)

:RUN_SETUP
set SETUP_PY=
if exist "%~dp0daemon\setup_ghostphone_windows.py" set SETUP_PY="%~dp0daemon\setup_ghostphone_windows.py"
if exist "%~dp0setup_ghostphone_windows.py" set SETUP_PY="%~dp0setup_ghostphone_windows.py"

if defined SETUP_PY (
    echo [✓] Iniciando configuracao e provisionamento automatico...
    %PY_RUN% %SETUP_PY%
    if %ERRORLEVEL% NEQ 0 (
        echo [!] Ocorreu um erro durante a instalacao.
        pause
    )
    exit /b 0
)

set SCRIPT=
if exist "%~dp0daemon\servidor_ponte_local.py" set SCRIPT="%~dp0daemon\servidor_ponte_local.py"
if exist "%~dp0servidor_ponte_local.py" set SCRIPT="%~dp0servidor_ponte_local.py"

if not defined SCRIPT (
    echo [!] Arquivos do GhostLens nao encontrados!
    echo Certifique-se de extrair o arquivo .zip antes de abrir.
    pause
    exit /b 1
)

echo [✓] Abrindo GhostLens Studio no navegador...
start http://127.0.0.1:4444

echo.
echo ==========================================================
echo   MOTOR GHOSTLENS ATIVO (PORTA 4444)
echo   Mantenha esta janela aberta enquanto utiliza o sistema.
echo ==========================================================
echo.

%PY_RUN% %SCRIPT%

echo.
echo [!] Servidor finalizado.
pause
