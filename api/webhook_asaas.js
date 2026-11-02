// ============================================================================
// GhostLens • Webhook Asaas (Vercel Serverless)
// Rota: /api/webhook_asaas
//
// - Exige ASAAS_WEBHOOK_TOKEN e REJEITA token divergente (antes só avisava).
// - Persiste a licença em public.ghost_licenses (idempotente por payment_id).
// - Envia a chave por e-mail (Resend, opcional via RESEND_API_KEY).
// ============================================================================
'use strict';

const {
  safeEqualStr,
  createOrGetLicense,
  sendLicenseEmail,
  planForAmountBRL,
  normalizeLicense,
  setCors
} = require('../lib/ghostlens-backend');
const { PLANS } = require('../lib/ghostlens-license-plans');

async function fetchAsaasCustomerEmail(customerId) {
  const apiKey = process.env.ASAAS_API_KEY || '';
  if (!apiKey || !customerId) return '';
  const base = (process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/customers/${encodeURIComponent(customerId)}`, {
      headers: { access_token: apiKey }
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.email || '';
  } catch (err) {
    console.warn('[asaas] Não foi possível buscar e-mail do cliente:', err.message);
    return '';
  }
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, asaas-access-token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens Asaas Webhook Engine 3.0'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN || '';
  if (!expectedToken) {
    console.error('[asaas] ASAAS_WEBHOOK_TOKEN ausente — evento recusado.');
    return res.status(503).json({ error: 'webhook_not_configured' });
  }

  const receivedToken = req.headers['asaas-access-token'] || req.query?.access_token || '';
  if (!safeEqualStr(receivedToken, expectedToken)) {
    console.warn('[asaas] Token de webhook inválido — evento recusado.');
    return res.status(401).json({ error: 'invalid_webhook_token' });
  }

  const body = req.body || {};
  const event = body.event || 'unknown';
  const payment = body.payment || {};
  console.log(`⚡ [asaas] Evento ${event} | ${payment.id || 'sem_id'} | R$ ${payment.value || 0}`);

  try {
    if (event !== 'PAYMENT_RECEIVED' && event !== 'PAYMENT_CONFIRMED') {
      return res.status(200).json({ received: true, ignored: event });
    }

    const paymentId = payment.id || '';
    if (!paymentId) {
      return res.status(400).json({ error: 'missing_payment_id' });
    }

    const externalReference = String(payment.externalReference || '').trim();

    // Recarga de carteira GhostLens: o crédito é feito pelo pix-webhook do
    // Supabase. Este endpoint NÃO deve emitir licença para esses pagamentos.
    if (externalReference.startsWith('GHOST|')) {
      return res.status(200).json({ received: true, ignored: 'ghost_wallet_recharge' });
    }

    let customerEmail = payment.customerEmail || payment.clientEmail || '';
    if (!customerEmail && payment.customer) {
      customerEmail = await fetchAsaasCustomerEmail(payment.customer);
    }

    const amountBRL = parseFloat(payment.value || '0') || 0;
    let tier;
    let days = 30;

    if (externalReference.startsWith('LICENSE|')) {
      // Formato: LICENSE|PLAN|BILLING|EMAIL
      const parts = externalReference.split('|');
      const planCode = String(parts[1] || '').toUpperCase();
      const billing = String(parts[2] || '').toUpperCase();
      const refEmail = String(parts[3] || '').trim();
      const plan = PLANS[planCode.toLowerCase()];

      if (!plan) {
        console.error('[asaas] referência de licença com plano inválido:', planCode);
        return res.status(400).json({ error: 'invalid_license_plan' });
      }

      tier = { code: plan.code, plan: plan.plan, maxDevices: plan.maxDevices };
      days = billing === 'ANNUAL' || billing === 'ANUAL' ? 365 : 30;

      if (!customerEmail && refEmail.includes('@')) {
        customerEmail = refEmail;
      }
    } else {
      // Compatibilidade com links antigos que não enviam metadata.
      tier = planForAmountBRL(amountBRL);
    }

    const license = await createOrGetLicense({
      email: customerEmail,
      amountBRL,
      provider: 'asaas',
      paymentId,
      days,
      ...tier
    });

    if (!license) {
      throw new Error('license_insert_returned_empty');
    }

    const emailResult = await sendLicenseEmail(license);
    console.log(
      `✅ [asaas] Licença ${license.code} emitida para ${license.email || 'sem-email'} ` +
      `(e-mail: ${emailResult.sent ? 'enviado' : emailResult.reason})`
    );

    return res.status(200).json({
      received: true,
      license_issued: true,
      email_sent: Boolean(emailResult.sent),
      license: {
        code: normalizeLicense(license).code,
        plan: license.plan
      }
    });
  } catch (err) {
    // 500 faz o Asaas reenviar o evento — desejável se o banco falhou.
    console.error('❌ [asaas] Erro ao processar pagamento:', err.status || '', err.message, err.data || '');
    return res.status(500).json({ error: 'processing_failed' });
  }
};
