@echo off
title GhostLens Suite
cls
echo ==========================================================
echo   GHOSTLENS DESKTOP SUITE - INICIALIZADOR
echo ==========================================================
echo.
cd /d "%~dp0"

:: Tenta localizar python em ordem
set PY_RUN=
python --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_RUN=python
    goto RUN_SERVER
)

py --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_RUN=py
    goto RUN_SERVER
)

if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python311\python.exe"
    goto RUN_SERVER
)

if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python312\python.exe"
    goto RUN_SERVER
)

if exist "%ProgramFiles%\Python311\python.exe" (
    set PY_RUN="%ProgramFiles%\Python311\python.exe"
    goto RUN_SERVER
)

echo [!] Python nao encontrado no computador.
echo Baixando instalador oficial do Python 3.11...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', '%TEMP%\py_inst.exe')"
if exist "%TEMP%\py_inst.exe" (
    echo Instalando Python...
    "%TEMP%\py_inst.exe" /passive PrependPath=1
    del "%TEMP%\py_inst.exe" >nul 2>&1
    set PY_RUN=python
    goto RUN_SERVER
) else (
    echo Falha ao baixar. Baixe em https://www.python.org/downloads/
    pause
    exit /b 1
)

:RUN_SERVER
set SCRIPT=
if exist "%~dp0daemon\servidor_ponte_local.py" set SCRIPT="%~dp0daemon\servidor_ponte_local.py"
if exist "%~dp0servidor_ponte_local.py" set SCRIPT="%~dp0servidor_ponte_local.py"

if not defined SCRIPT (
    echo [!] Arquivo servidor_ponte_local.py nao encontrado!
    echo Certifique-se de extrair o arquivo .zip antes de abrir.
    pause
    exit /b 1
)

echo [✓] Abrindo GhostLens Studio no navegador...
start https://ghostlens.cloud/studio

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
