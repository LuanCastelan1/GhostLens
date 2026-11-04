// ============================================================================
// GhostLens • Minha Licença (Vercel Serverless)
// Rota: /api/my_license
//
// POST (Authorization: Bearer <Supabase JWT>)
//   → devolve apenas as licenças do e-mail autenticado, com chave, plano,
//     validade e dispositivos vinculados.
//
// Nunca aceita e-mail por parâmetro: o dono é sempre o usuário do JWT.
// ============================================================================
'use strict';

const {
  setCors,
  enforceRateLimit,
  supabaseRest
} = require('../lib/ghostlens-backend');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens License Portal 1.0',
      backend: SUPABASE_SERVICE_ROLE_KEY ? 'ready' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ success: false, error: 'portal_not_configured' });
  }

  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'unauthorized' });

    const user = await getSupabaseUser(token);
    if (!user || !user.email) {
      return res.status(401).json({ success: false, error: 'unauthorized' });
    }

    try {
      const limit = await enforceRateLimit(`my-license:${user.id}`, 30, 600);
      if (!limit.allowed) {
        return res.status(429).json({ success: false, error: 'rate_limited', reset_at: limit.reset_at });
      }
    } catch (rateErr) {
      console.warn('[my_license] rate limit indisponível:', rateErr.message);
    }

    const email = String(user.email).trim().toLowerCase();
    const licenses = await supabaseRest(
      `ghost_licenses?email=eq.${encodeURIComponent(email)}&select=id,key,plan,code,max_devices,status,expires_at,target_hwid,bound_at,created_at&order=created_at.desc`
    );

    const output = [];
    for (const license of Array.isArray(licenses) ? licenses : []) {
      let devices = [];
      try {
        devices = await supabaseRest(
          `ghost_license_devices?license_id=eq.${encodeURIComponent(license.id)}&revoked_at=is.null&select=hwid,last_seen_at&order=last_seen_at.desc`
        );
      } catch (deviceErr) {
        console.warn('[my_license] falha ao listar devices:', deviceErr.message);
      }
      output.push({
        id: license.id,
        key: license.key,
        plan: license.plan,
        code: license.code,
        max_devices: license.max_devices,
        status: license.status,
        expires_at: license.expires_at,
        target_hwid: license.target_hwid || null,
        bound_at: license.bound_at || null,
        created_at: license.created_at,
        devices: (Array.isArray(devices) ? devices : []).map((d) => ({
          hwid: d.hwid,
          last_seen_at: d.last_seen_at
        }))
      });
    }

    return res.status(200).json({
      success: true,
      email,
      licenses: output
    });
  } catch (err) {
    console.error('[my_license] erro:', err.message);
    return res.status(502).json({ success: false, error: 'license_portal_unavailable' });
  }
};
