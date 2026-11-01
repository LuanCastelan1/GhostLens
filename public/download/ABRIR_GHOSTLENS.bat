@echo off
title GhostLens Suite & GhostPhone Engine
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

if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python313\python.exe"
    goto RUN_SERVER
)

if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python312\python.exe"
    goto RUN_SERVER
)

if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python311\python.exe"
    goto RUN_SERVER
)

if exist "%LocalAppData%\Programs\Python\Python310\python.exe" (
    set PY_RUN="%LocalAppData%\Programs\Python\Python310\python.exe"
    goto RUN_SERVER
)

if exist "%ProgramFiles%\Python312\python.exe" (
    set PY_RUN="%ProgramFiles%\Python312\python.exe"
    goto RUN_SERVER
)

if exist "%ProgramFiles%\Python311\python.exe" (
    set PY_RUN="%ProgramFiles%\Python311\python.exe"
    goto RUN_SERVER
)

echo [!] Python nao encontrado. Execute primeiro o Instalar_GhostLens_Windows.bat!
pause
exit /b 1

:RUN_SERVER
set SCRIPT=
if exist "%~dp0daemon\servidor_ponte_local.py" set SCRIPT="%~dp0daemon\servidor_ponte_local.py"
if exist "%~dp0servidor_ponte_local.py" set SCRIPT="%~dp0servidor_ponte_local.py"

if not defined SCRIPT (
    echo [!] Arquivo do servidor GhostLens nao encontrado!
    echo Certifique-se de extrair todos os arquivos do arquivo .zip.
    pause
    exit /b 1
)

echo [✓] Abrindo GhostLens Studio no navegador...
start http://127.0.0.1:4444

echo.
echo ==========================================================
echo   🚀 GHOSTLENS SUITE & GHOSTPHONE ATIVO (PORTA 4444)
echo   Painel Web: http://127.0.0.1:4444
echo   Mantenha esta janela aberta enquanto utiliza o sistema.
echo ==========================================================
echo.

%PY_RUN% %SCRIPT%

echo.
echo [!] Servidor finalizado.
pause
