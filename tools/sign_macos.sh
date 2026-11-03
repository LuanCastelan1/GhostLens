#!/usr/bin/env bash
# ============================================================================
# GhostLens • Assinatura + notarização macOS
#
# Pré-requisitos:
#   1. Apple Developer Program ativo.
#   2. Certificado "Developer ID Application: ... (TEAMID)" no Keychain.
#   3. Credenciais de notarização salvas:
#        xcrun notarytool store-credentials "ghostlens-notary" \
#          --apple-id "SEU_APPLE_ID" \
#          --team-id "SEU_TEAM_ID" \
#          --password "SENHA_DE_APP_ESPECIFICA"
#
# Uso:
#   SIGN_IDENTITY="Developer ID Application: SUA EMPRESA (TEAMID)" \
#   NOTARY_PROFILE="ghostlens-notary" \
#   PUBLISH=1 \
#   ./tools/sign_macos.sh
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT/mac_build/GhostLens.app}"
DMG_ROOT="${DMG_ROOT:-$ROOT/mac_build/dmg_root}"
OUT_DMG="${OUT_DMG:-$ROOT/mac_build/GhostLens-signed.dmg}"
IDENTITY="${SIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
PUBLISH="${PUBLISH:-0}"

if [[ ! -d "$APP" ]]; then
  echo "❌ App não encontrado: $APP"
  exit 1
fi

if [[ -z "$IDENTITY" ]]; then
  echo "❌ Defina SIGN_IDENTITY com o nome exato do certificado."
  echo "   Certificados disponíveis:"
  security find-identity -v -p codesigning || true
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -Fq "$IDENTITY"; then
  echo "❌ Certificado não encontrado no Keychain: $IDENTITY"
  security find-identity -v -p codesigning || true
  exit 1
fi

echo "🔐 Assinando o app: $APP"
codesign --force --deep --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "✅ App assinado."

if [[ -d "$DMG_ROOT" ]]; then
  echo "📦 Sincronizando app assinado em dmg_root e recriando o DMG..."
  rm -rf "$DMG_ROOT/GhostLens.app"
  cp -R "$APP" "$DMG_ROOT/GhostLens.app"
  rm -f "$OUT_DMG"
  hdiutil create -volname "GhostLens" -srcfolder "$DMG_ROOT" -fs APFS -format UDZO -ov "$OUT_DMG"

  echo "🔐 Assinando o DMG..."
  codesign --force --timestamp --sign "$IDENTITY" "$OUT_DMG"
  codesign --verify --verbose=2 "$OUT_DMG"
  echo "✅ DMG assinado."
else
  echo "⚠️ dmg_root não encontrado; DMG não foi recriado."
fi

if [[ -n "$NOTARY_PROFILE" && -f "$OUT_DMG" ]]; then
  echo "📤 Enviando para notarização (pode levar alguns minutos)..."
  xcrun notarytool submit "$OUT_DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  echo "📎 Grampeando ticket..."
  xcrun stapler staple "$OUT_DMG"
  xcrun stapler validate "$OUT_DMG"
  echo "✅ Notarização concluída."
else
  echo "⚠️ NOTARY_PROFILE vazio: o DMG foi assinado, mas NÃO notarizado."
  echo "   Sem notarização o Gatekeeper ainda pode exibir aviso."
fi

if [[ "$PUBLISH" == "1" && -f "$OUT_DMG" ]]; then
  cp "$OUT_DMG" "$ROOT/download/GhostLens.dmg"
  cp "$OUT_DMG" "$ROOT/public/download/GhostLens.dmg"
  echo "✅ DMG assinado publicado em download/ e public/download/."
fi

echo "🎉 Concluído: $OUT_DMG"
