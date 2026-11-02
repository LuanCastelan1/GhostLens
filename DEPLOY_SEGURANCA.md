# GhostLens • Deploy e correções de segurança (v3.0)

Este documento cobre as mudanças aplicadas nos itens P0/P1: licenciamento
server-side, remoção dos bypasses de admin, validação de webhooks, proteção do
daemon e remoção de segredos do frontend.

---

## 1. Rodar o schema no Supabase

No SQL Editor do projeto `mbelyevitfksmknlyhgr`:

```
supabase/schema_ghostlens_licenses.sql
```

Cria `public.ghost_licenses`, RLS sem policies públicas e a função atômica
`bind_ghost_license`. Somente a `service_role` acessa.

## 2. Configurar variáveis na Vercel

Use `.env.example` como referência. Obrigatórias para o fluxo de licenças:

| Variável | Para quê |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Ler/gravar licenças (sem ela, `verify_license` responde 503) |
| `STRIPE_WEBHOOK_SECRET` | Validar `stripe-signature` |
| `ASAAS_WEBHOOK_TOKEN` | Validar `asaas-access-token` |
| `RESEND_API_KEY` | Enviar a chave ao cliente (opcional) |

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

## 5. Daemon local

- A ativação agora chama `POST /api/verify_license` (tenta
  `ghostlens.cloud`, `www.ghostlens.cloud` e `ghostlens.com.br`) e exige licença
  registrada no banco. Sem internet ou sem registro → ativação recusada (falha
  fechada). Ajuste com `GHOSTLENS_ACTIVATION_URL` se o domínio for outro.
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

Os clientes que já têm `license.key` continuam funcionando até a expiração
(o arquivo local é validado por HWID + data, sem consulta online). Mas, para
**reativar** uma chave antiga, ela precisa existir em `ghost_licenses`.

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

## 8. Instaladores regerados (v3.0.0)

Os pacotes publicados foram regerados com o código corrigido:

| Pacote | Origem |
|---|---|
| `windows_build/GhostLens_Setup.exe` | NSIS + `payload/` com `.pyc` recompilados (Python 3.12) |
| `mac_build/GhostLens.dmg` | app macOS com `.py` novos, imagem APFS UDZO |
| `public/download/GhostLens-Setup-Windows.zip` | pacote portátil Windows |
| `public/download/GhostLens-Installer-macOS.zip` | pacote portátil macOS |
| `download/` e `public/download/` | cópias dos `.exe`/`.dmg` substituídas |

Versão 3.0.0 no instalador NSIS e no `Info.plist` do app.

## 9. Testes rápidos

```bash
# health
curl -s https://SEU-DOMINIO/api/verify_license

# deve falhar sem licença no banco
curl -s -X POST https://SEU-DOMINIO/api/verify_license \
  -H 'Content-Type: application/json' \
  -d '{"key":"GHOST-PRO-AAAA-BBBB-CCCC","hwid":"GP-MAC-TEST"}'

# webhook Asaas sem token deve dar 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://SEU-DOMINIO/api/webhook_asaas \
  -H 'Content-Type: application/json' -d '{"event":"PAYMENT_RECEIVED"}'
```

## 10. Itens ainda pendentes

- Rotação da chave WaveSpeed é manual (painel + revogação). Ela ainda existe no
  histórico do git e nos arquivos do ErosChat (produto separado).
- Consolidação do `index.html` em um único fonte (hoje são 4 cópias iguais).
- `check_network` ainda mede o IP do host, não do emulador.
- Os `.exe/.dmg` versionados são os instaladores de entrega do GhostPhone; não
  devem ser removidos do repositório.
