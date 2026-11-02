// ============================================================================
// GhostLens • Checkout de licença (Stripe, cartão) — mensal/anual
// Rota: /api/create_license_checkout
//
// POST { plan: 'solo'|'pro'|'agency', billing: 'monthly'|'annual', email? }
// Retorna { url } para o Checkout da Stripe. O preço e a duração são definidos
// no servidor; o webhook lê metadata {type, plan, billing, days} para emitir
// a licença correta (30 ou 365 dias).
// ============================================================================
'use strict';

const { setCors, getClientIp, enforceRateLimit } = require('../lib/ghostlens-backend');
const {
  PLANS,
  normalizePlan,
  normalizeBilling,
  daysForBilling,
  lookupKey
} = require('../lib/ghostlens-license-plans');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SITE_URL = (process.env.GHOSTLENS_SITE_URL || 'https://www.ghostlens.cloud').replace(/\/+$/, '');
const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeRequest(path, options = {}) {
  const res = await fetch(`${STRIPE_API}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
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

async function getPriceId(lookup) {
  const query = new URLSearchParams({
    'lookup_keys[]': lookup,
    active: 'true',
    limit: '1'
  });
  const data = await stripeRequest(`prices?${query.toString()}`, { method: 'GET' });
  const price = data && data.data && data.data[0];
  if (!price) throw new Error('stripe_price_not_found');
  return price.id;
}

async function createCheckoutSession({ priceId, plan, billing, days, email }) {
  const params = {
    mode: 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    customer_creation: 'always',
    'metadata[type]': 'license',
    'metadata[plan]': plan.code,
    'metadata[billing]': billing,
    'metadata[days]': days,
    'payment_intent_data[metadata][type]': 'license',
    'payment_intent_data[metadata][plan]': plan.code,
    'payment_intent_data[metadata][billing]': billing,
    'payment_intent_data[metadata][days]': days,
    success_url: `${SITE_URL}/obrigado?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/download.html`
  };

  if (email) params.customer_email = email;

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }

  return stripeRequest('checkout/sessions', { method: 'POST', body });
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens License Checkout 1.0',
      stripe: STRIPE_SECRET_KEY ? 'configured' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!STRIPE_SECRET_KEY) {
    console.error('[license_checkout] STRIPE_SECRET_KEY ausente');
    return res.status(503).json({ error: 'checkout_not_configured' });
  }

  try {
    const body = req.body || {};
    const planKey = normalizePlan(body.plan);
    const plan = PLANS[planKey];
    const billing = normalizeBilling(body.billing);
    const days = daysForBilling(billing);
    const email = typeof body.email === 'string' ? body.email.trim() : '';

    if (!plan) {
      return res.status(400).json({ error: 'invalid_plan' });
    }

    try {
      const ip = getClientIp(req);
      const limit = await enforceRateLimit(`license-checkout-ip:${ip}`, 20, 600);
      if (!limit.allowed) {
        return res.status(429).json({ error: 'rate_limited', reset_at: limit.reset_at });
      }
    } catch (rateErr) {
      // Não bloqueia a venda se o rate limit estiver indisponível.
      console.warn('[license_checkout] rate limit indisponível:', rateErr.message);
    }

    const priceId = await getPriceId(lookupKey(planKey, billing));
    const session = await createCheckoutSession({ priceId, plan, billing, days, email });

    console.log(`[license_checkout] ${plan.code} ${billing} | session ${session.id}`);
    return res.status(200).json({
      success: true,
      url: session.url,
      session_id: session.id
    });
  } catch (err) {
    console.error('[license_checkout] erro:', err.status || '', err.message, err.data || '');
    return res.status(502).json({ error: 'checkout_unavailable' });
  }
};
