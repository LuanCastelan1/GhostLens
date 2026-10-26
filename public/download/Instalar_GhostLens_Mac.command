#!/bin/bash
# ==============================================================================
# 👁️ GHOSTLENS™ DESKTOP SUITE - INSTALADOR DE 1 CLIQUE (MACOS APPLE SILICON & INTEL)
# ==============================================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=========================================================="
echo "⚡ Instalando GhostLens™ Desktop Suite..."
echo "=========================================================="

# Garante permissões
chmod +x "$DIR/daemon/servidor_ponte_local.py" 2>/dev/null

# Inicia o daemon em background com proteção
nohup python3 "$DIR/daemon/servidor_ponte_local.py" > /tmp/ghostlens_bridge.log 2>&1 &

echo "✓ Motor GhostStealth Bridge Ativo na porta 4444!"
echo "✓ Abrindo o GhostLens Web Studio no navegador..."
sleep 2
open "https://ghostlens.vercel.app/studio" || open "http://localhost:4444"
