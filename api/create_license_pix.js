// ============================================================================
// GhostLens • Checkout de licença via PIX (Asaas)
// Rota: /api/create_license_pix
//
// POST { plan:'solo'|'pro'|'agency', billing:'monthly'|'annual',
//        name, email, cpfCnpj }
// Cria a cobrança e devolve o QR. O webhook /api/webhook_asaas emite a
// licença quando o Asaas confirmar (externalReference LICENSE|PLAN|BILLING|EMAIL).
// ============================================================================
'use strict';

const { setCors, getClientIp, enforceRateLimit } = require('../lib/ghostlens-backend');
const {
  PLANS,
  normalizePlan,
  normalizeBilling,
  daysForBilling
} = require('../lib/ghostlens-license-plans');

const ASAAS_API = (process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3').replace(/\/+$/, '');
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';

async function asaasRequest(path, options = {}) {
  const res = await fetch(`${ASAAS_API}/${path}`, {
    ...options,
    headers: {
      access_token: ASAAS_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error(`asaas_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function findOrCreateCustomer({ name, email, cpfCnpj }) {
  const search = await asaasRequest(`customers?email=${encodeURIComponent(email)}`);
  if (search && Array.isArray(search.data) && search.data.length > 0) {
    const customer = search.data[0];
    if (cpfCnpj && customer.cpfCnpj !== cpfCnpj) {
      await asaasRequest(`customers/${customer.id}`, {
        method: 'POST',
        body: JSON.stringify({ cpfCnpj })
      });
      customer.cpfCnpj = cpfCnpj;
    }
    return customer;
  }
  return asaasRequest('customers', {
    method: 'POST',
    body: JSON.stringify({ name, email, cpfCnpj })
  });
}

function dueDate() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens License Pix 1.0',
      asaas: ASAAS_API_KEY ? 'configured' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!ASAAS_API_KEY) {
    console.error('[license_pix] ASAAS_API_KEY ausente');
    return res.status(503).json({ error: 'pix_not_configured' });
  }

  try {
    const body = req.body || {};
    const planKey = normalizePlan(body.plan);
    const plan = PLANS[planKey];
    const billing = normalizeBilling(body.billing);
    const billingUpper = billing === 'annual' ? 'ANNUAL' : 'MONTHLY';
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const cpfCnpj = String(body.cpfCnpj || '').replace(/\D/g, '');
    const amountCents = plan ? plan[billing] : 0;

    if (!plan) {
      return res.status(400).json({ error: 'invalid_plan' });
    }
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'name_required', message: 'Informe seu nome completo.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'email_required', message: 'Informe um e-mail válido.' });
    }
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      return res.status(400).json({ error: 'cpf_required', message: 'Informe o CPF ou CNPJ do pagador.' });
    }

    try {
      const limit = await enforceRateLimit(`license-pix-ip:${getClientIp(req)}`, 20, 600);
      if (!limit.allowed) {
        return res.status(429).json({ error: 'rate_limited', reset_at: limit.reset_at });
      }
    } catch (rateErr) {
      console.warn('[license_pix] rate limit indisponível:', rateErr.message);
    }

    const customer = await findOrCreateCustomer({ name, email, cpfCnpj });
    if (!customer || !customer.id) {
      throw new Error('asaas_customer_failed');
    }

    const amountBRL = amountCents / 100;
    const payment = await asaasRequest('payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: customer.id,
        billingType: 'PIX',
        value: amountBRL,
        dueDate: dueDate(),
        description: `GhostLens ${plan.plan} - ${billing === 'annual' ? 'Anual' : 'Mensal'}`,
        externalReference: `LICENSE|${plan.code}|${billingUpper}|${email}`
      })
    });

    if (!payment || !payment.id) {
      throw new Error('asaas_payment_failed');
    }

    const qr = await asaasRequest(`payments/${payment.id}/pixQrCode`);

    console.log(`[license_pix] ${plan.code} ${billing} | ${email} | R$ ${amountBRL} | payment ${payment.id}`);
    return res.status(200).json({
      ok: true,
      payment_id: payment.id,
      amount: amountBRL,
      plan: plan.plan,
      days: daysForBilling(billing),
      encodedImage: (qr && qr.encodedImage) || '',
      payload: (qr && qr.payload) || ''
    });
  } catch (err) {
    console.error('[license_pix] erro:', err.status || '', err.message, err.data || '');
    if (err.status === 400 && err.data && Array.isArray(err.data.errors)) {
      return res.status(400).json({
        error: 'payment_rejected',
        message: err.data.errors[0]?.description || 'Dados do pagador inválidos.'
      });
    }
    return res.status(502).json({ error: 'pix_unavailable' });
  }
};
