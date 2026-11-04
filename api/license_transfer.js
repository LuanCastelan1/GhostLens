// ============================================================================
// GhostLens • Troca de computador (Vercel Serverless)
// Rota: /api/license_transfer
//
// POST (Authorization: Bearer <Supabase JWT>)
// { license_id, new_hwid? }
//
// • Verifica que a licença pertence ao e-mail autenticado.
// • Limita a 1 troca a cada 30 dias por licença (bucket no Supabase).
// • Revoga os dispositivos antigos e desvincula o HWID.
// • Se new_hwid for enviado, já deixa a licença pré-vinculada nessa máquina.
// ============================================================================
'use strict';

const {
  setCors,
  enforceRateLimit,
  supabaseRest
} = require('../lib/ghostlens-backend');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TRANSFER_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HWID_RE = /^[A-Z0-9-]{4,100}$/;

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

async function releaseBucket(bucket) {
  try {
    await supabaseRest(
      `ghost_rate_limits?bucket=eq.${encodeURIComponent(bucket)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ count: 0, window_start: new Date().toISOString() })
      }
    );
  } catch (err) {
    console.warn('[license_transfer] falha ao liberar bucket:', err.message);
  }
}

function isoFromReset(resetAt) {
  const numeric = Number(resetAt);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return new Date(Date.now() + TRANSFER_WINDOW_SECONDS * 1000).toISOString();
  }
  return new Date(numeric * 1000).toISOString();
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens License Transfer 1.0',
      cooldown_days: 30,
      backend: SUPABASE_SERVICE_ROLE_KEY ? 'ready' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ success: false, error: 'transfer_not_configured' });
  }

  let bucket = '';
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'unauthorized' });

    const user = await getSupabaseUser(token);
    if (!user || !user.email) {
      return res.status(401).json({ success: false, error: 'unauthorized' });
    }
    const email = String(user.email).trim().toLowerCase();

    const body = req.body || {};
    const licenseId = String(body.license_id || '').trim().toLowerCase();
    const newHwid = String(body.new_hwid || '').trim().toUpperCase();

    if (!UUID_RE.test(licenseId)) {
      return res.status(400).json({ success: false, error: 'invalid_license_id' });
    }
    if (newHwid && !HWID_RE.test(newHwid)) {
      return res.status(400).json({ success: false, error: 'invalid_hwid' });
    }

    try {
      const userLimit = await enforceRateLimit(`license-transfer-user:${user.id}`, 10, 600);
      if (!userLimit.allowed) {
        return res.status(429).json({ success: false, error: 'rate_limited', next_allowed_at: isoFromReset(userLimit.reset_at) });
      }
    } catch (rateErr) {
      console.warn('[license_transfer] rate limit de usuário indisponível:', rateErr.message);
    }

    const rows = await supabaseRest(
      `ghost_licenses?id=eq.${licenseId}&select=id,key,email,status,expires_at,target_hwid&limit=1`
    );
    const license = Array.isArray(rows) ? rows[0] : null;
    if (!license || String(license.email || '').trim().toLowerCase() !== email) {
      return res.status(404).json({ success: false, error: 'license_not_found' });
    }
    if (license.status !== 'active') {
      return res.status(403).json({ success: false, error: 'license_inactive', message: 'Licença revogada ou inativa.' });
    }
    if (new Date(license.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ success: false, error: 'license_expired', message: 'Licença expirada. Renove o plano.' });
    }

    // Trava de 30 dias por licença (bucket atômico no Supabase).
    bucket = `license-transfer:${licenseId}`;
    const limit = await enforceRateLimit(bucket, 1, TRANSFER_WINDOW_SECONDS);
    if (!limit.allowed) {
      return res.status(429).json({
        success: false,
        error: 'transfer_cooldown',
        message: 'Esta licença já foi transferida nos últimos 30 dias.',
        next_allowed_at: isoFromReset(limit.reset_at)
      });
    }

    const nowIso = new Date().toISOString();

    // Revoga as máquinas antigas primeiro; depois libera/pré-vincula o HWID.
    try {
      await supabaseRest(
        `ghost_license_devices?license_id=eq.${licenseId}&revoked_at=is.null`,
        { method: 'PATCH', body: JSON.stringify({ revoked_at: nowIso }) }
      );
    } catch (deviceErr) {
      await releaseBucket(bucket);
      console.error('[license_transfer] falha ao revogar devices:', deviceErr.message);
      return res.status(502).json({ success: false, error: 'transfer_failed' });
    }

    try {
      await supabaseRest(
        `ghost_licenses?id=eq.${licenseId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            target_hwid: newHwid || null,
            bound_at: newHwid ? nowIso : null
          })
        }
      );
    } catch (licenseErr) {
      await releaseBucket(bucket);
      console.error('[license_transfer] falha ao atualizar licença:', licenseErr.message);
      return res.status(502).json({ success: false, error: 'transfer_failed' });
    }

    return res.status(200).json({
      success: true,
      message: newHwid
        ? 'Computador anterior desvinculado. A licença já está presa ao novo HWID informado.'
        : 'Computador anterior desvinculado. A próxima máquina que ativar a chave ficará vinculada.',
      license_id: licenseId,
      prebound_hwid: newHwid || null,
      next_allowed_at: isoFromReset(limit.reset_at),
      instructions: 'Abra http://127.0.0.1:4444/player no novo computador e ative com a mesma chave e o e-mail da conta.'
    });
  } catch (err) {
    if (bucket) await releaseBucket(bucket);
    console.error('[license_transfer] erro:', err.message);
    return res.status(502).json({ success: false, error: 'transfer_unavailable' });
  }
};
