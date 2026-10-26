@echo off
title GhostLens Enterprise Suite - Setup
echo ==========================================================
echo   GHOSTLENS DESKTOP SUITE - INSTALADOR WINDOWS 10 / 11
echo ==========================================================
echo Iniciando o daemon em background...
start /B python daemon\servidor_ponte_local.py
timeout /t 2 >nul
start https://ghostlens.vercel.app/studio
echo Instalacao concluida com sucesso!
pause
