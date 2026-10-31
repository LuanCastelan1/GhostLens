@echo off
title GhostLens Enterprise Suite - Setup
chcp 65001 >nul
cls
echo ==========================================================
echo   GHOSTLENS DESKTOP SUITE - INICIALIZADOR WINDOWS 10 / 11
echo ==========================================================
echo [1/3] Verificando ambiente Python...

set "PY_CMD="
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 set "PY_CMD=python"
if not defined PY_CMD (
    where py >nul 2>&1
    if %ERRORLEVEL% EQU 0 set "PY_CMD=py"
)

:: Verifica caminhos comuns caso o Python tenha sido instalado sem marcar o PATH
if not defined PY_CMD (
    for /d %%D in ("%LocalAppData%\Programs\Python\Python*") do (
        if exist "%%D\python.exe" set "PY_CMD=%%D\python.exe"
    )
)
if not defined PY_CMD (
    for /d %%D in ("%ProgramFiles%\Python*") do (
        if exist "%%D\python.exe" set "PY_CMD=%%D\python.exe"
    )
)

if not defined PY_CMD (
    echo.
    echo [!] Python não detectado no seu computador.
    echo [*] BAIXANDO E INSTALANDO O PYTHON OFICIAL AUTOMATICAMENTE...
    echo [*] Isso leva cerca de 30 a 60 segundos, por favor aguarde...
    echo.
    set "PY_INSTALLER=%TEMP%\python-installer.exe"
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', '%PY_INSTALLER%')"
    
    if exist "%PY_INSTALLER%" (
        echo [*] Executando instalador silencioso do Python (configurando PATH)...
        "%PY_INSTALLER%" /passive PrependPath=1 Include_pip=1
        timeout /t 5 >nul
        del "%PY_INSTALLER%" >nul 2>&1
        
        :: Atualiza PATH da sessão atual
        set "PATH=%LocalAppData%\Programs\Python\Python311;%LocalAppData%\Programs\Python\Python311\Scripts;%ProgramFiles%\Python311;%ProgramFiles%\Python311\Scripts;%PATH%"
        set "PY_CMD=python"
        echo [✓] Python instalado com sucesso e integrado ao sistema!
    ) else (
        echo [!] Falha no download automático. Baixe manualmente em https://www.python.org/downloads/
        pause
        exit /b 1
    )
) else (
    echo [✓] Python localizado com sucesso!
)

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
echo [✓] Abrindo o GhostLens Studio no navegador...
start https://ghostlens.cloud/studio

echo.
echo ==========================================================
echo   🚀 INICIANDO MOTOR GHOSTLENS LOCAL (PORTA 4444)
echo   Esta janela mantém a conexão ativa com o seu celular.
echo   NÃO FECHE esta janela enquanto estiver usando o Studio!
echo ==========================================================
echo.

:: Executa o servidor na própria janela para vermos qualquer log/erro em tempo real
%PY_CMD% "%TARGET_SCRIPT%"

echo.
echo ==========================================================
echo [!] O servidor foi encerrado.
echo Se você viu alguma mensagem de erro acima, tire um print!
echo ==========================================================
pause
