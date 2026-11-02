// ============================================================================
// GhostLens • Validação de licença (Vercel Serverless)
// Rota: /api/verify_license
//
// A licença precisa existir em public.ghost_licenses (criada pelos webhooks de
// pagamento). O HWID é vinculado atomicamente no primeiro uso. Falha fechada:
// sem banco configurado, nenhuma licença é aceita.
// ============================================================================
'use strict';

const {
  backendConfigured,
  supabaseRest,
  normalizeLicense,
  isValidKeyShape,
  getClientIp,
  enforceRateLimit,
  setCors
} = require('../lib/ghostlens-backend');

const ERROR_STATUS = {
  license_not_found: 404,
  hwid_mismatch: 403,
  license_expired: 410,
  license_inactive: 403,
  device_limit_reached: 403,
  device_revoked: 403
};

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, X-GhostLens-Hwid');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens License Sentinel 3.0',
      backend: backendConfigured() ? 'ready' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  if (!backendConfigured()) {
    console.error('[verify_license] SUPABASE_SERVICE_ROLE_KEY ausente — recusando validação.');
    return res.status(503).json({
      success: false,
      error: 'license_backend_unavailable'
    });
  }

  try {
    const { key, hwid, email } = req.body || {};
    const cleanKey = String(key || '').trim().toUpperCase();
    const cleanHwid = String(hwid || req.headers['x-ghostlens-hwid'] || '').trim().toUpperCase();

    if (!cleanKey || !cleanHwid) {
      return res.status(400).json({
        success: false,
        error: 'key_and_hwid_required'
      });
    }

    if (!isValidKeyShape(cleanKey)) {
      return res.status(403).json({
        success: false,
        error: 'invalid_license_format'
      });
    }

    const ip = getClientIp(req);
    const ipLimit = await enforceRateLimit(`verify-ip:${ip}`, 20, 600);
    if (!ipLimit.allowed) {
      return res.status(429).json({
        success: false,
        error: 'rate_limited',
        reset_at: ipLimit.reset_at
      });
    }

    const result = await supabaseRest('rpc/bind_ghost_license_device', {
      method: 'POST',
      body: JSON.stringify({ p_key: cleanKey, p_hwid: cleanHwid })
    });

    if (!result || result.success !== true || !result.license) {
      const code = (result && result.error) || 'license_not_found';
      const status = ERROR_STATUS[code] || 403;
      return res.status(status).json({
        success: false,
        error: code,
        bound_hwid: result && result.bound_hwid ? result.bound_hwid : undefined
      });
    }

    const license = normalizeLicense(result.license);

    // Mantém o e-mail informado na ativação apenas se ele já for o da licença.
    if (email && String(email).toLowerCase() !== String(license.email).toLowerCase()) {
      console.warn('[verify_license] e-mail divergente na ativação (ignorado):', email);
    }

    console.log(`[verify_license] Licença ativada: ${license.key} • HWID ${cleanHwid}`);
    return res.status(200).json({
      success: true,
      message: `Licença ${license.plan} ativada e vinculada à máquina.`,
      license
    });
  } catch (err) {
    console.error('[verify_license] Erro:', err.status || '', err.message, err.data || '');
    return res.status(503).json({
      success: false,
      error: 'license_backend_unavailable'
    });
  }
};
