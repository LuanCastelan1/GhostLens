// ============================================================================
// GhostLens • Recarga de créditos via PIX (Asaas)
// Rota: /api/create_credit_pix
//
// POST { pack_id: 'ghost_1'|'ghost_10'|'ghost_25'|'ghost_50'|'ghost_100' }
// Authorization: Bearer <access_token do Supabase>
//
// O webhook /api/webhook_asaas credita a carteira quando o Asaas confirmar
// o pagamento (externalReference GHOSTV2|email|valor).
// ============================================================================
'use strict';

const { setCors, getClientIp, enforceRateLimit } = require('../lib/ghostlens-backend');

const ASAAS_API = (process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3').replace(/\/+$/, '');
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const PACKS = {
  ghost_1: 1,
  ghost_10: 10,
  ghost_25: 25,
  ghost_50: 50,
  ghost_100: 100
};

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

async function getSupabaseUser(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  return res.json();
}

async function findOrCreateCustomer(email, cpfCnpj) {
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
  const name = (email.split('@')[0] || 'Cliente').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 40) || 'Cliente';
  return asaasRequest('customers', {
    method: 'POST',
    body: JSON.stringify({ name, email, cpfCnpj })
  });
}

function dueDate() {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens Pix Credit 1.0',
      asaas: ASAAS_API_KEY ? 'configured' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!ASAAS_API_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[credit_pix] Asaas/Supabase não configurados');
    return res.status(503).json({ error: 'pix_not_configured' });
  }

  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const user = await getSupabaseUser(token);
    if (!user || !user.email) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const body = req.body || {};
    const packId = String(body.pack_id || '').trim();
    const amount = PACKS[packId];
    const cpfCnpj = String(body.cpfCnpj || '').replace(/\D/g, '');

    if (!amount) {
      return res.status(400).json({ error: 'invalid_pack' });
    }

    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      return res.status(400).json({ error: 'cpf_required', message: 'Informe o CPF ou CNPJ do pagador.' });
    }

    try {
      const limit = await enforceRateLimit(`credit-pix-ip:${getClientIp(req)}`, 20, 600);
      if (!limit.allowed) {
        return res.status(429).json({ error: 'rate_limited', reset_at: limit.reset_at });
      }
    } catch (rateErr) {
      console.warn('[credit_pix] rate limit indisponível:', rateErr.message);
    }

    const customer = await findOrCreateCustomer(user.email, cpfCnpj);
    if (!customer || !customer.id) {
      throw new Error('asaas_customer_failed');
    }

    const payment = await asaasRequest('payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: customer.id,
        billingType: 'PIX',
        value: amount,
        dueDate: dueDate(),
        description: `Recarga GhostLens Studio - R$ ${amount.toFixed(2)}`,
        externalReference: `GHOSTV2|${user.email}|${amount}`
      })
    });

    if (!payment || !payment.id) {
      throw new Error('asaas_payment_failed');
    }

    const qr = await asaasRequest(`payments/${payment.id}/pixQrCode`);

    console.log(`[credit_pix] ${user.email} | R$ ${amount} | payment ${payment.id}`);
    return res.status(200).json({
      ok: true,
      payment_id: payment.id,
      encodedImage: (qr && qr.encodedImage) || '',
      payload: (qr && qr.payload) || ''
    });
  } catch (err) {
    console.error('[credit_pix] erro:', err.status || '', err.message, err.data || '');
    if (err.status === 400 && err.data && Array.isArray(err.data.errors)) {
      return res.status(400).json({
        error: 'payment_rejected',
        message: err.data.errors[0]?.description || 'Dados do pagador inválidos.'
      });
    }
    return res.status(502).json({ error: 'pix_unavailable' });
  }
};
