# GhostLens • Deploy e correções de segurança (v3.1)

Este documento cobre as mudanças aplicadas nos itens P0/P1: licenciamento
server-side, sessão JWT curta, limite de devices, rate limit, remoção dos
bypasses de admin, validação de webhooks, proteção do daemon e checksums dos
downloads automáticos.

---

## 1. Rodar o schema no Supabase

No SQL Editor do projeto `mbelyevitfksmknlyhgr`:

```
supabase/schema_ghostlens_licenses.sql
```

Cria/atualiza:

- `public.ghost_licenses` (licenças)
- `public.ghost_license_devices` (devices por licença, respeitando `max_devices`)
- `public.ghost_rate_limits` (rate limit compartilhado entre instâncias)
- Funções `bind_ghost_license`, `bind_ghost_license_device` e `check_rate_limit`

O script é idempotente. Rode-o de novo após atualizar o código para criar as
tabelas/funções novas. RLS sem policies públicas: somente a `service_role`
acessa.

## 2. Configurar variáveis na Vercel

Use `.env.example` como referência. Obrigatórias para o fluxo de licenças:

| Variável | Para quê |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Ler/gravar licenças e devices (sem ela, os endpoints respondem 503) |
| `GHOSTLENS_SESSION_SECRET` | Assinar os JWT de sessão (mínimo 32 caracteres; sem ele → 503) |
| `STRIPE_WEBHOOK_SECRET` | Validar `stripe-signature` |
| `ASAAS_WEBHOOK_TOKEN` | Validar `asaas-access-token` |
| `RESEND_API_KEY` | Enviar a chave ao cliente (opcional) |
| `GHOSTLENS_SESSION_TTL` | Validade da sessão em segundos (default 86400) |

## 3. Rotacionar a chave WaveSpeed (URGENTE)

A chave antiga estava hardcoded em `index.html` e nas cópias públicas.

1. Gere uma nova chave no painel WaveSpeed e **revogue a antiga**.
2. Abra o Studio → painel admin (3 cliques no cabeçalho) → cole o novo token
   admin do daemon → salve a chave WaveSpeed.
3. A chave fica somente em `localStorage` do navegador do admin. O código não
   contém mais nenhum segredo.

## 4. Webhooks

Configure as URLs:

- Stripe: `https://SEU-DOMINIO/api/webhook_stripe`
- Asaas:  `https://SEU-DOMINIO/api/webhook_asaas`

Comportamento novo:

- Stripe: assinatura inválida → `400`; sem segredo configurado → `503`.
- Asaas: token ausente/errado → `401`/`503`.
- Licença é persistida antes de responder e é idempotente por `payment_id`.
- O e-mail com a chave é enviado via Resend quando configurado.
- A chave **não** é devolvida na resposta HTTP do gateway.

> Observação: na Vercel o body pode chegar já parseado. A assinatura Stripe é
> conferida sobre `JSON.stringify(req.body)` nesse caso. Se você tiver volume
> alto, migre essa rota para Next.js com `bodyParser: false` para usar os bytes
> crus.

## 5. Daemon local e sessão server-side

- A ativação/renovação chama `POST /api/license_session` (tenta
  `ghostlens.cloud`, `www.ghostlens.cloud` e `ghostlens.com.br`).
- O servidor valida licença + device no Supabase e devolve um **JWT curto**
  (default 24h). O daemon renova antes de vencer.
- Revogação, `max_devices` e expiração valem já na próxima renovação.
- Janelas de tolerância:
  - `GHOSTLENS_OFFLINE_GRACE_HOURS` (default 24h): sessão vencida ainda roda
    offline nesse intervalo.
  - `GHOSTLENS_LEGACY_GRACE_HOURS` (default 72h): janela de migração para
    licenças antigas que ainda não têm sessão.
  - Ajuste as URLs com `GHOSTLENS_SESSION_URL`/`GHOSTLENS_SESSION_URLS`.
- Chaves master hardcoded, auto-ativação e aceitação de qualquer `GHOST-*`
  foram removidas.
- Endpoints administrativos (`/api/auth/generate_token`,
  `/api/auth/issued_licenses`, `/api/auth/admin_check`) exigem o header
  `X-Ghost-Admin-Token`.
- O token fica em `~/.ghostphone/admin_token` (permissão 600) ou em
  `GHOSTLENS_ADMIN_TOKEN`. Para obter:

```bash
cat ~/.ghostphone/admin_token
```

- No Studio, use o e-mail admin + esse token no campo de senha para entrar como
  admin. O painel também aceita o token colado no prompt.

## 6. Migrar licenças já emitidas

Licenças antigas (sem sessão) ganham uma janela de migração de
`GHOSTLENS_LEGACY_GRACE_HOURS` (default 72h), durante a qual o daemon tenta
obter a sessão. Se a chave não estiver em `ghost_licenses`, após a janela o
acesso é bloqueado. Migre **antes** de distribuir a v3.1 para os clientes.

Migre o histórico local do admin:

```bash
export SUPABASE_URL=https://mbelyevitfksmknlyhgr.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...
python3 tools/migrate_issued_licenses.py
```

O script lê `~/.ghostphone/issued_licenses.json`, é idempotente e não imprime
chaves/e-mails completos.

## 7. Licenças manuais

`/api/auth/generate_token` agora grava a chave com
`status = "pending_registration"`. Ela **não ativa** até ser inserida em
`ghost_licenses`. Para emissão manual:

```sql
insert into public.ghost_licenses (key, email, plan, code, max_devices, provider, expires_at)
values ('GHOST-PRO-XXXX-XXXX-XXXX', 'cliente@exemplo.com',
        'GhostLens Pro (3 Dispositivos)', 'PRO', 3, 'manual', now() + interval '30 days');
```

## 8. Instaladores regerados (v3.1.1)

Os pacotes publicados foram regerados com o código corrigido (sessão JWT,
checksums e correção da janela de migração):

| Pacote | Origem |
|---|---|
| `windows_build/GhostLens_Setup.exe` | NSIS + `payload/` com `.pyc` recompilados (Python 3.12) |
| `mac_build/GhostLens.dmg` | app macOS com `.py` novos, imagem APFS UDZO |
| `public/download/GhostLens-Setup-Windows.zip` | pacote portátil Windows |
| `public/download/GhostLens-Installer-macOS.zip` | pacote portátil macOS |
| `download/` e `public/download/` | cópias dos `.exe`/`.dmg` substituídas |

Versão 3.1.1 no instalador NSIS e no `Info.plist` do app.

## 9. Testes rápidos

```bash
# health das duas rotas
curl -s https://SEU-DOMINIO/api/verify_license
curl -s https://SEU-DOMINIO/api/license_session

# sessão sem licença registrada → 404 (e rate limit após 10 tentativas)
curl -s -X POST https://SEU-DOMINIO/api/license_session \
  -H 'Content-Type: application/json' \
  -d '{"key":"GHOST-PRO-AAAA-BBBB-CCCC","hwid":"GP-MAC-TEST"}'

# refresh sem token → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://SEU-DOMINIO/api/license_session

# webhook Asaas sem token deve dar 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://SEU-DOMINIO/api/webhook_asaas \
  -H 'Content-Type: application/json' -d '{"event":"PAYMENT_RECEIVED"}'
```

## 10. Itens ainda pendentes

- **Assinatura de código** (Apple Developer ID + notarização; Authenticode no
  Windows). É o que impede um instalador falso de se passar pelo oficial.
- **Update assinado** (Ed25519/minisign) para o cliente verificar atualizações.
- **Auditoria das edge functions/RLS** (`process-media`, `pix-checkout`,
  `create-vip-checkout`, `ghost_wallets`). A cobrança real tem de ser
  server-side.
- **Empacotar o Mac com Nuitka** — hoje o `.app` entrega `.py` legível; o
  Windows entrega `.pyc`, que é decompilável. Obfuscação atrasa, não impede.
- Rotação da chave WaveSpeed é manual (painel + revogação). Ela ainda existe no
  histórico do git e nos arquivos do ErosChat (produto separado).
- Consolidação do `index.html` em um único fonte (hoje são 4 cópias iguais).
- `check_network` ainda mede o IP do host, não do emulador.
- Os `.exe/.dmg` versionados são os instaladores de entrega do GhostPhone; não
  devem ser removidos do repositório.
- Checksums: scrcpy, JRE e command-line tools estão pinados. Os pacotes que o
  `sdkmanager` baixa depois são verificados pelo próprio SDK.
