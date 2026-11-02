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
  setCors
} = require('../lib/ghostlens-backend');

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
    const tier = planForAmountBRL(amountBRL);

    const license = await createOrGetLicense({
      email: customerEmail,
      amountBRL,
      provider: 'stripe',
      paymentId,
      days: 30,
      ...tier
    });

    if (!license) {
      throw new Error('license_insert_returned_empty');
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
