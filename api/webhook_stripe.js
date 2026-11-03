// ============================================================================
// GhostLens • Webhook Stripe (Vercel Serverless)
// Rota: /api/webhook_stripe
//
// - Valida a assinatura stripe-signature (STRIPE_WEBHOOK_SECRET).
// - Persiste a licença em public.ghost_licenses (idempotente por payment_id).
// - Envia a chave por e-mail (Resend, opcional via RESEND_API_KEY).
//
// ⚠️ A Vercel pode entregar o body já parseado. Quando isso acontece, a
// assinatura é conferida sobre o JSON re-serializado. Para produção de alto
// volume, prefira uma rota Next.js com bodyParser desligado ou capture o
// rawBody no edge/proxy.
// ============================================================================
'use strict';

const {
  readRawBody,
  verifyStripeSignature,
  createOrGetLicense,
  sendLicenseEmail,
  planForAmountBRL,
  normalizeLicense,
  findLicenseByKey,
  supabaseRest,
  setCors
} = require('../lib/ghostlens-backend');
const {
  PLANS,
  normalizePlan,
  normalizeBilling,
  daysForBilling
} = require('../lib/ghostlens-license-plans');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeApi(path, options = {}) {
  const res = await fetch(`${STRIPE_API}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(options.body instanceof URLSearchParams
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error(`stripe_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function releaseBucket(bucket) {
  try {
    await supabaseRest(`ghost_rate_limits?bucket=eq.${encodeURIComponent(bucket)}`, {
      method: 'PATCH',
      body: JSON.stringify({ count: 0, window_start: new Date().toISOString() })
    });
  } catch (err) {
    console.error('[stripe] Falha ao liberar idempotência:', err.message);
  }
}

async function renewLicense({ key, days, invoiceId }) {
  const bucket = `license-renewal:${invoiceId}`;
  let lock;
  try {
    lock = await supabaseRest('rpc/check_rate_limit', {
      method: 'POST',
      body: JSON.stringify({ p_bucket: bucket, p_limit: 1, p_window_seconds: 31536000 })
    });
  } catch (err) {
    return { ok: false, error: 'idempotency_unavailable' };
  }

  if (!lock || lock.allowed !== true) {
    return { ok: false, duplicate: true };
  }

  const license = await findLicenseByKey(key);
  if (!license || license.status !== 'active') {
    await releaseBucket(bucket);
    return { ok: false, error: 'license_not_found' };
  }

  const now = Date.now();
  const current = new Date(license.expires_at).getTime();
  const base = Math.max(now, Number.isFinite(current) ? current : now);
  const newExpiry = new Date(base + days * 86400000).toISOString();

  try {
    await supabaseRest(`ghost_licenses?key=eq.${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ expires_at: newExpiry })
    });
  } catch (err) {
    await releaseBucket(bucket);
    return { ok: false, error: 'renewal_failed' };
  }

  return { ok: true, expires_at: newExpiry };
}

async function setSubscriptionLicenseMetadata(subscriptionId, license, tier, billing, days) {
  const id = typeof subscriptionId === 'string' ? subscriptionId : (subscriptionId && subscriptionId.id);
  if (!id) return;
  const body = new URLSearchParams();
  body.set('metadata[license_key]', license.key);
  body.set('metadata[type]', 'license');
  body.set('metadata[plan]', tier.code);
  body.set('metadata[billing]', billing);
  body.set('metadata[days]', String(days));
  body.set('metadata[auto_renew]', 'true');
  await stripeApi(`subscriptions/${id}`, { method: 'POST', body });
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, stripe-signature');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens Stripe Webhook Engine 3.0'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!webhookSecret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET ausente — evento recusado.');
    return res.status(503).json({ error: 'webhook_not_configured' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];

  if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
    console.warn('[stripe] Assinatura inválida — evento recusado.');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const eventType = event.type || 'unknown';
  const object = (event.data && event.data.object) || {};
  console.log(`⚡ [stripe] Evento ${eventType} | ${event.id || 'sem_id'}`);

  try {
    // Renovação automática de assinatura de licença: estende a chave existente.
    if (eventType === 'invoice.payment_succeeded' && object.subscription) {
      const subId = typeof object.subscription === 'string'
        ? object.subscription
        : object.subscription.id;

      // A primeira fatura é coberta pelo checkout.session.completed.
      if (object.billing_reason === 'subscription_create') {
        return res.status(200).json({ received: true, ignored: 'first_subscription_invoice' });
      }

      let subscription = null;
      try {
        subscription = await stripeApi(`subscriptions/${subId}`);
      } catch (stripeErr) {
        console.error('[stripe] Falha ao buscar assinatura para renovação:', stripeErr.message);
      }

      const meta = (subscription && subscription.metadata) || {};
      if (meta.type === 'license' && meta.license_key) {
        const days = parseInt(meta.days, 10) || 30;
        const renewal = await renewLicense({
          key: meta.license_key,
          days,
          invoiceId: object.id
        });
        return res.status(200).json({
          received: true,
          renewed: renewal.ok,
          duplicate: Boolean(renewal.duplicate),
          expires_at: renewal.expires_at,
          error: renewal.error
        });
      }

      return res.status(200).json({ received: true, ignored: 'non_license_subscription' });
    }

    let amountCents = 0;
    let customerEmail = '';
    let paymentId = '';

    if (eventType === 'checkout.session.completed') {
      amountCents = object.amount_total || 0;
      customerEmail = (object.customer_details && object.customer_details.email) ||
        object.customer_email || '';
      paymentId = object.id || '';
    } else if (eventType === 'invoice.payment_succeeded') {
      amountCents = object.amount_paid || 0;
      customerEmail = object.customer_email || '';
      paymentId = object.id || '';
    } else {
      return res.status(200).json({ received: true, ignored: eventType });
    }

    if (!paymentId) {
      return res.status(400).json({ error: 'missing_payment_id' });
    }

    const amountBRL = amountCents / 100;
    const metadata = object.metadata ||
      (object.subscription_details && object.subscription_details.metadata) || {};

    let tier;
    let days = 30;
    let billing = 'monthly';

    if (metadata.type === 'license') {
      const plan = PLANS[normalizePlan(metadata.plan)];
      if (!plan) {
        console.error('[stripe] metadata de licença com plano inválido:', metadata.plan);
        return res.status(400).json({ error: 'invalid_license_plan' });
      }
      billing = normalizeBilling(metadata.billing);
      tier = { code: plan.code, plan: plan.plan, maxDevices: plan.maxDevices };
      days = parseInt(metadata.days, 10) || daysForBilling(billing);
    } else {
      // Compatibilidade com links antigos que não enviam metadata.
      tier = planForAmountBRL(amountBRL);
    }

    const license = await createOrGetLicense({
      email: customerEmail,
      amountBRL,
      provider: 'stripe',
      paymentId,
      days,
      ...tier
    });

    if (!license) {
      throw new Error('license_insert_returned_empty');
    }

    // Assinatura: guarda a chave na subscription para as renovações futuras.
    if (metadata.type === 'license' && object.subscription) {
      try {
        await setSubscriptionLicenseMetadata(object.subscription, license, tier, billing, days);
      } catch (subErr) {
        console.error('[stripe] Falha ao gravar metadata da assinatura:', subErr.message, subErr.data || '');
      }
    }

    const emailResult = await sendLicenseEmail(license);
    console.log(
      `✅ [stripe] Licença ${license.code} emitida para ${license.email || 'sem-email'} ` +
      `(e-mail: ${emailResult.sent ? 'enviado' : emailResult.reason})`
    );

    // Stripe só precisa do 2xx. A chave NÃO é devolvida na resposta.
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
    // 500 faz o Stripe reenviar o evento — desejável se o banco falhou.
    console.error('❌ [stripe] Erro ao processar pagamento:', err.status || '', err.message, err.data || '');
    return res.status(500).json({ error: 'processing_failed' });
  }
};
