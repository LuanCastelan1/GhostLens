# Assinatura de código — GhostLens

Os instaladores atuais **não são assinados**. Eles funcionam, mas Windows SmartScreen
e macOS Gatekeeper exibem avisos. Este documento cobre como assinar quando houver
certificado.

---

## macOS

### O que precisa
- **Apple Developer Program** (US$ 99/ano).
- Certificado **Developer ID Application** no Keychain.
- Credenciais de notarização (App Store Connect API key ou app-specific password).

Empresa exige **D-U-N-S**; conta individual é mais rápida.

### Salvar credenciais de notarização
```bash
xcrun notarytool store-credentials "ghostlens-notary" \
  --apple-id "SEU_APPLE_ID" \
  --team-id "SEU_TEAM_ID" \
  --password "SENHA_DE_APP_ESPECIFICA"
```

### Assinar + notarizar
```bash
SIGN_IDENTITY="Developer ID Application: SUA EMPRESA (TEAMID)" \
NOTARY_PROFILE="ghostlens-notary" \
PUBLISH=1 \
./tools/sign_macos.sh
```

O script:
1. assina o `.app` com hardened runtime e timestamp;
2. recria o DMG com o app assinado;
3. assina o DMG;
4. notariza, grampeia e valida;
5. com `PUBLISH=1`, copia para `download/` e `public/download/`.

---

## Windows

### Opções
| Opção | Custo aprox. | Observação |
|---|---:|---|
| Azure Trusted Signing | ~US$ 10/mês | Assinatura em nuvem, boa para CI |
| OV Code Signing (Certum/SSL.com) | US$ 200–400/ano | Token/HSM ou nuvem |
| EV Code Signing | US$ 400–700/ano | Reputação SmartScreen mais rápida |

Desde 2023 as CAs exigem chave privada em token FIPS 140-2 Level 2 ou HSM/cloud.

### PFX exportável (se o certificado permitir)
```bash
brew install osslsigncode
WINDOWS_PFX="/caminho/certificado.pfx" \
WINDOWS_PFX_PASSWORD="senha" \
PUBLISH=1 \
./tools/sign_windows.sh
```

### Token/HSM ou Azure (Windows/CI)
```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a "GhostLens_Setup.exe"
signtool verify /pa "GhostLens_Setup.exe"
```

Para Azure Trusted Signing, configure a conta no Azure, valide a identidade e
assine pelo portal/CI.

---

## Instalação sem assinatura (enquanto não houver certificado)

### Windows
1. Abra o `GhostLens_Setup.exe`.
2. Se aparecer “Windows protegeu seu PC”, clique em **Mais informações**.
3. Clique em **Executar assim mesmo**.
4. Se o antivírus bloquear, adicione uma exceção para o instalador.

### macOS
1. Abra o `GhostLens.dmg` e arraste o app para **Aplicativos**.
2. Clique com o botão direito no app → **Abrir** → **Abrir**.
3. Se não abrir: **Ajustes do Sistema → Privacidade e Segurança → “Abrir mesmo assim”**.
4. Alternativa avançada:
   ```bash
   xattr -dr com.apple.quarantine /Applications/GhostLens.app
   ```

---

## Segurança da chave

- Nunca compartilhe a chave privada, o PFX ou o token de assinatura.
- Use token/HSM/cloud; evite PFX em disco quando possível.
- Se um PFX for usado, apague-o depois da assinatura.
- Certificado de code signing é alvo de malware: trate como credencial bancária.
