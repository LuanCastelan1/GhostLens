#!/usr/bin/env bash
# ============================================================================
# GhostLens • Assinatura Windows (Authenticode)
#
# Modos suportados:
#   A) PFX exportável (OV cert vendido como arquivo):
#        WINDOWS_PFX="/caminho/certificado.pfx" \
#        WINDOWS_PFX_PASSWORD="senha" \
#        PUBLISH=1 ./tools/sign_windows.sh
#      Requer: brew install osslsigncode
#
#   B) Token físico / HSM / Azure Trusted Signing:
#      Rode no Windows (ou CI) com signtool:
#        signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a "GhostLens_Setup.exe"
#
# Observação: desde 2023 as CAs normalmente entregam a chave em token/HSM,
# então o modo A só funciona se o certificado permitir exportação PFX.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXE="${1:-$ROOT/windows_build/GhostLens_Setup.exe}"
PFX="${WINDOWS_PFX:-}"
PASS="${WINDOWS_PFX_PASSWORD:-}"
TSA="${WINDOWS_TSA:-http://timestamp.digicert.com}"
OUT="${OUT_EXE:-${EXE%.exe}-signed.exe}"
PUBLISH="${PUBLISH:-0}"

if [[ ! -f "$EXE" ]]; then
  echo "❌ Executável não encontrado: $EXE"
  exit 1
fi

if ! command -v osslsigncode >/dev/null 2>&1; then
  cat <<'EOF'
⚠️ osslsigncode não encontrado.

No macOS:
  brew install osslsigncode

Se o seu certificado for token/HSM ou Azure Trusted Signing, assine no Windows/CI:

  signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a "GhostLens_Setup.exe"

Para Azure Trusted Signing, configure uma conta de Trusted Signing no Azure,
valide a identidade e assine via portal/CI do Azure.

Depois de assinar, verifique:
  signtool verify /pa "GhostLens_Setup.exe"
EOF
  exit 1
fi

if [[ -z "$PFX" || ! -f "$PFX" ]]; then
  echo "❌ Defina WINDOWS_PFX com o caminho do .pfx exportável."
  echo "   Se o certificado estiver em token/HSM, use signtool no Windows (veja acima)."
  exit 1
fi

echo "🔐 Assinando: $EXE"
osslsigncode sign \
  -pkcs12 "$PFX" \
  -pass "$PASS" \
  -n "GhostLens Studio" \
  -i "https://www.ghostlens.cloud" \
  -h sha256 \
  -ts "$TSA" \
  -in "$EXE" \
  -out "$OUT"

echo "🔎 Verificando assinatura..."
osslsigncode verify -in "$OUT" || {
  echo "❌ Falha na verificação da assinatura."
  exit 1
}

if [[ "$PUBLISH" == "1" ]]; then
  cp "$OUT" "$ROOT/download/GhostLens_Setup.exe"
  cp "$OUT" "$ROOT/public/download/GhostLens_Setup.exe"
  echo "✅ Executável assinado publicado em download/ e public/download/."
fi

echo "🎉 Concluído: $OUT"
