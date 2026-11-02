// ============================================================================
// GhostLens • Entrega da licença na página de sucesso
// Rota: /api/license_lookup?session_id=cs_...
//
// Confirma na Stripe que o Checkout foi pago e devolve a chave emitida pelo
// webhook. O session_id é o segredo do comprador (vem na URL de sucesso) e a
// Stripe confirma o pagamento antes de expor qualquer chave.
// ============================================================================
'use strict';

const {
  setCors,
  getClientIp,
  enforceRateLimit,
  findLicenseByPaymentId,
  normalizeLicense
} = require('../lib/ghostlens-backend');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

async function getCheckoutSession(sessionId) {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
  );
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error(`stripe_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query || {};
  let sessionId = String(query.session_id || '').trim();
  if (!sessionId && req.body && typeof req.body === 'object') {
    sessionId = String(req.body.session_id || '').trim();
  }

  if (req.method === 'GET' && !sessionId) {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens License Lookup 1.0',
      stripe: STRIPE_SECRET_KEY ? 'configured' : 'not_configured'
    });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'session_id_required' });
  }

  if (!STRIPE_SECRET_KEY) {
    console.error('[license_lookup] STRIPE_SECRET_KEY ausente');
    return res.status(503).json({ error: 'lookup_not_configured' });
  }

  try {
    try {
      const ip = getClientIp(req);
      const limit = await enforceRateLimit(`license-lookup-ip:${ip}`, 30, 600);
      if (!limit.allowed) {
        return res.status(429).json({ error: 'rate_limited', reset_at: limit.reset_at });
      }
    } catch (rateErr) {
      console.warn('[license_lookup] rate limit indisponível:', rateErr.message);
    }

    let session;
    try {
      session = await getCheckoutSession(sessionId);
    } catch (stripeErr) {
      if (stripeErr.status === 404) {
        return res.status(404).json({ error: 'session_not_found' });
      }
      throw stripeErr;
    }

    if (!session || session.status !== 'complete' || session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'payment_not_confirmed' });
    }

    const license = await findLicenseByPaymentId(sessionId);
    if (!license) {
      // O webhook pode ainda estar processando; a página tenta de novo.
      return res.status(404).json({ error: 'license_pending', retry: true });
    }

    const normalized = normalizeLicense(license);
    return res.status(200).json({
      success: true,
      license: {
        key: normalized.key,
        plan: normalized.plan,
        code: normalized.code,
        max_devices: normalized.max_devices,
        status: normalized.status,
        expires_at: normalized.expires_at
      }
    });
  } catch (err) {
    console.error('[license_lookup] erro:', err.status || '', err.message);
    return res.status(502).json({ error: 'lookup_unavailable' });
  }
};
