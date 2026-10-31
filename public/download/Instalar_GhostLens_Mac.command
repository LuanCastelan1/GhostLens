#!/bin/bash
# ==============================================================================
# 👁️ GHOSTLENS™ DESKTOP SUITE - INICIALIZADOR MACOS (APPLE SILICON & INTEL)
# ==============================================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=========================================================="
echo "  GHOSTLENS DESKTOP SUITE - INICIALIZADOR MACOS"
echo "=========================================================="
echo "[1/3] Verificando ambiente Python 3..."

if ! command -v python3 &> /dev/null; then
    echo ""
    echo "[!] Python 3 não encontrado no seu Mac."
    echo "Abra o Terminal e digite: xcode-select --install"
    echo "Ou baixe o instalador oficial em: https://www.python.org/downloads/macos/"
    echo ""
    read -p "Pressione ENTER para fechar..."
    exit 1
fi

echo "[✓] Python 3 localizado com sucesso!"
echo ""
echo "[2/3] Localizando o servidor ponte GhostLens..."

TARGET_SCRIPT=""
if [ -f "$DIR/daemon/servidor_ponte_local.py" ]; then
    TARGET_SCRIPT="$DIR/daemon/servidor_ponte_local.py"
elif [ -f "$DIR/servidor_ponte_local.py" ]; then
    TARGET_SCRIPT="$DIR/servidor_ponte_local.py"
fi

if [ -z "$TARGET_SCRIPT" ]; then
    echo "[!] Arquivo servidor_ponte_local.py não encontrado."
    echo "Certifique-se de extrair o arquivo .zip completamente!"
    read -p "Pressione ENTER para fechar..."
    exit 1
fi

echo "[✓] Servidor localizado: $TARGET_SCRIPT"
echo "[✓] Iniciando motor GhostStealth Bridge (Porta 4444)..."
chmod +x "$TARGET_SCRIPT" 2>/dev/null
nohup python3 "$TARGET_SCRIPT" > /tmp/ghostlens_bridge.log 2>&1 &

sleep 2

echo ""
echo "[3/3] Abrindo o GhostLens Studio no navegador..."
open "https://ghostlens.cloud/studio" || open "http://localhost:4444"

echo ""
echo "=========================================================="
echo "  ✓ GHOSTLENS SUITE PRONTO PARA OPERAR!"
echo "  Mantenha esta janela aberta enquanto utiliza o GhostLens."
echo "=========================================================="
