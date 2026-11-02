// ============================================================================
// GhostLens • Sessão server-side (Vercel Serverless)
// Rota: /api/license_session
//
// POST { key, hwid }          → valida a licença, registra o device e emite JWT
// POST (Authorization: Bearer) → renova o JWT enquanto a licença/device valerem
//
// O token é curto (GHOSTLENS_SESSION_TTL, default 24h) e assinado com
// GHOSTLENS_SESSION_SECRET. Revogação no banco vale já na próxima renovação.
// ============================================================================
'use strict';

const {
  backendConfigured,
  sessionConfigured,
  supabaseRest,
  normalizeLicense,
  signSession,
  verifySession,
  getClientIp,
  enforceRateLimit,
  setCors,
  SESSION_TTL_SECONDS
} = require('../lib/ghostlens-backend');

const ERROR_STATUS = {
  license_not_found: 404,
  hwid_mismatch: 403,
  license_expired: 410,
  license_inactive: 403,
  device_limit_reached: 403,
  device_revoked: 403
};

const ERROR_MESSAGES = {
  license_not_found: 'Licença não encontrada.',
  license_expired: 'Licença expirada. Renove seu plano.',
  license_inactive: 'Licença revogada ou inativa.',
  device_limit_reached: 'Limite de dispositivos do plano atingido.',
  device_revoked: 'Este dispositivo foi desautorizado pelo administrador.',
  invalid_session: 'Sessão inválida ou expirada.'
};

function respond(res, status, payload) {
  return res.status(status).json(payload);
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens Session Authority 1.0',
      backend: backendConfigured() ? 'ready' : 'not_configured',
      sessions: sessionConfigured() ? 'ready' : 'not_configured',
      ttl_seconds: SESSION_TTL_SECONDS
    });
  }

  if (req.method !== 'POST') {
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }

  if (!backendConfigured() || !sessionConfigured()) {
    console.error('[license_session] Supabase ou GHOSTLENS_SESSION_SECRET não configurado.');
    return respond(res, 503, { success: false, error: 'session_backend_unavailable' });
  }

  try {
    const authHeader = String(req.headers.authorization || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const body = req.body || {};

    let key;
    let hwid;
    let refreshed = false;

    if (bearer) {
      const claims = verifySession(bearer);
      if (!claims) {
        return respond(res, 401, {
          success: false,
          error: 'invalid_session',
          message: ERROR_MESSAGES.invalid_session
        });
      }
      key = String(claims.sub).toUpperCase();
      hwid = String(claims.hwid).toUpperCase();
      refreshed = true;
    } else {
      key = String(body.key || '').trim().toUpperCase();
      hwid = String(body.hwid || '').trim().toUpperCase();
    }

    if (!key || !hwid) {
      return respond(res, 400, { success: false, error: 'key_and_hwid_required' });
    }

    // Rate limit por IP e por chave (compartilhado entre instâncias)
    const ip = getClientIp(req);
    const ipLimit = await enforceRateLimit(`session-ip:${ip}`, 30, 600);
    if (!ipLimit.allowed) {
      return respond(res, 429, { success: false, error: 'rate_limited', reset_at: ipLimit.reset_at });
    }

    const keyLimit = await enforceRateLimit(`session-key:${key}`, 10, 600);
    if (!keyLimit.allowed) {
      return respond(res, 429, { success: false, error: 'rate_limited', reset_at: keyLimit.reset_at });
    }

    const result = await supabaseRest('rpc/bind_ghost_license_device', {
      method: 'POST',
      body: JSON.stringify({ p_key: key, p_hwid: hwid })
    });

    if (!result || result.success !== true || !result.license) {
      const code = (result && result.error) || 'license_not_found';
      const status = ERROR_STATUS[code] || 403;
      return respond(res, status, {
        success: false,
        error: code,
        message: ERROR_MESSAGES[code] || 'Licença recusada.',
        max_devices: result && result.max_devices
      });
    }

    const license = normalizeLicense(result.license);
    const session = signSession({
      sub: license.key,
      hwid,
      plan: license.plan,
      code: license.code,
      max_devices: license.max_devices,
      ver: 1
    });

    console.log(
      `[license_session] ${refreshed ? 'renovada' : 'criada'} • ${license.code} • ` +
      `device ${result.device_count || 1}/${license.max_devices}`
    );

    return respond(res, 200, {
      success: true,
      token: session.token,
      token_type: 'Bearer',
      expires_at: session.expires_at,
      ttl_seconds: SESSION_TTL_SECONDS,
      device_count: result.device_count || 1,
      license
    });
  } catch (err) {
    console.error('[license_session] Erro:', err.status || '', err.message, err.data || '');
    return respond(res, 503, { success: false, error: 'session_backend_unavailable' });
  }
};
