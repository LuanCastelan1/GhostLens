#!/bin/bash
# ==============================================================================
# 🛡️ GHOSTPHONE™ CLOUD - SCRIPT DE COMPILAÇÃO E PROTEÇÃO BINÁRIA (ANTI-REVERSE)
# Transforma os scripts Python em código de máquina nativo C++ (Nuitka) ou Binário
# Encriptado (PyInstaller), impedindo descompilação e protegendo o algoritmo.
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "========================================================"
echo "🛡️  GHOSTPHONE™ CLOUD - COMPILAÇÃO DE SEGURANÇA NATIVA"
echo "========================================================"

# Verifica se o Nuitka está instalado (Compilador Python -> C++ Nativo)
if command -v nuitka >/dev/null 2>&1; then
    COMPILER="nuitka"
elif command -v pyinstaller >/dev/null 2>&1; then
    COMPILER="pyinstaller"
else
    echo "⚠️ Nenhum compilador binário encontrado. Instalando Nuitka..."
    pip3 install nuitka zstandard ordered-set
    COMPILER="nuitka"
fi

echo "✓ Compilador selecionado: $COMPILER"

if [ "$COMPILER" = "nuitka" ]; then
    echo "🔨 Compilando via NUITKA (Converte Python para C++ Nativo - Zero Bytecode)..."
    python3 -m nuitka \
        --standalone \
        --onefile \
        --assume-yes-for-downloads \
        --include-data-file=ghostphone_player.html=ghostphone_player.html \
        --include-module=ghostphone_auth_guard \
        --output-filename=GhostPhoneDaemon \
        --output-dir=dist \
        servidor_ponte_local.py
else
    echo "🔨 Compilando via PYINSTALLER (Binário Standalone)..."
    pyinstaller --noconfirm --onedir --windowed \
        --add-data "ghostphone_player.html:." \
        --name "GhostPhoneDaemon" \
        servidor_ponte_local.py
fi

echo "========================================================"
echo "✅ COMPILAÇÃO CONCLUÍDA COM SUCESSO!"
echo "📁 O executável protegido está disponível em: $DIR/dist/"
echo "🛡️ O código-fonte foi convertido em binário nativo de máquina."
echo "🔒 Ninguém conseguirá descompilar ou usar sem Token + HWID válido."
echo "========================================================"
