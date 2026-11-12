// registry-include-v3
// ============================================================================
// GhostLens • Proxy WaveSpeed (4K/8K)
// Rota: /api/wavespeed_proxy
//
// Mantém a chave WaveSpeed só no servidor. O navegador nunca recebe a chave.
// Requer login Supabase e licença ativa OU saldo na carteira (ou e-mail owner).
//
// POST { action: 'upload_ticket', filename, size }
// POST { action: 'infer', kind: 'fps'|'upscale', download_url }
// POST { action: 'poll', poll_url }
// POST { action: 'tts', text, voice, language, style }
// POST { action: 'fetch_audio', url }
// ============================================================================
'use strict';

const {
  setCors,
  enforceRateLimit,
  supabaseRest
} = require('../lib/ghostlens-backend');
const { generateCreatorImage, generateCreatorFromVision, queryCreatorTask, getCreatorCatalog, getCreatorUsage, creatorConfigured, visionConfigured } = require('../lib/creator');
const { getRunningHubCatalog } = require('../lib/runninghub');

const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY || '';
const WAVESPEED_API = (process.env.WAVESPEED_API_BASE || 'https://api.wavespeed.ai/api/v3').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OWNER_EMAILS = (process.env.GHOSTLENS_OWNER_EMAILS || 'luan@ghostlens.ai')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const TTS_MODEL = 'wavespeed-ai/qwen3-tts/text-to-speech';
const TTS_VOICES = new Set(['Vivian', 'Serena', 'Ono_Anna', 'Sohee', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden']);
const TTS_LANGUAGES = new Set(['auto', 'Portuguese', 'English', 'Spanish', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Russian', 'Chinese']);
const TTS_MAX_CHARS = 2000;
const TTS_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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

async function isEntitled(user) {
  const email = String(user.email || '').toLowerCase();
  if (!email) return false;
  if (user.app_metadata && user.app_metadata.role === 'admin') return true;
  if (OWNER_EMAILS.includes(email)) return true;

  const now = new Date().toISOString();
  try {
    const licenses = await supabaseRest(
      `ghost_licenses?email=eq.${encodeURIComponent(email)}&status=eq.active&expires_at=gt.${encodeURIComponent(now)}&select=key&limit=1`
    );
    if (Array.isArray(licenses) && licenses.length > 0) return true;
  } catch (err) {
    console.warn('[wavespeed_proxy] falha ao checar licença:', err.message);
  }

  try {
    const wallets = await supabaseRest(
      `ghost_wallets?user_id=eq.${encodeURIComponent(user.id)}&select=balance&limit=1`
    );
    if (Array.isArray(wallets) && wallets.length > 0 && Number(wallets[0].balance) > 0) {
      return true;
    }
  } catch (err) {
    console.warn('[wavespeed_proxy] falha ao checar carteira:', err.message);
  }

  return false;
}

async function wavespeed(path, options = {}) {
  const res = await fetch(`${WAVESPEED_API}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${WAVESPEED_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error(`wavespeed_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function isAllowedDownloadUrl(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host.endsWith('.cloudfront.net') || host.endsWith('.wavespeed.ai');
  } catch {
    return false;
  }
}

function isAllowedPollUrl(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'api.wavespeed.ai' && parsed.pathname.startsWith('/api/v3/');
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  setCors(res, 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const queryAction = String((req.query && req.query.action) || '').trim();
    if (queryAction === 'creator_catalog') {
      return res.status(200).json({ models: getCreatorCatalog() });
    }
    return res.status(200).json({
      status: 'online',
      service: 'GhostLens Media Proxy 1.2',
      wavespeed: WAVESPEED_API_KEY ? 'configured' : 'not_configured',
      creator: creatorConfigured ? 'configured' : 'not_configured',
      runninghub: process.env.RUNNINGHUB_API_KEY ? 'configured' : 'not_configured',
      workflows_loaded: getRunningHubCatalog().length,
      vision: visionConfigured ? 'configured' : 'not_configured'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[wavespeed_proxy] Supabase não configurado');
    return res.status(503).json({ error: 'proxy_not_configured' });
  }

  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const user = await getSupabaseUser(token);
    if (!user || !user.email) return res.status(401).json({ error: 'unauthorized' });

    if (!(await isEntitled(user))) {
      return res.status(403).json({
        error: 'entitlement_required',
        message: 'É necessário ter uma licença ativa ou créditos na carteira para usar 4K/8K.'
      });
    }

    try {
      const limit = await enforceRateLimit(`wavespeed-user:${user.id}`, 120, 600);
      if (!limit.allowed) {
        return res.status(429).json({ error: 'rate_limited', reset_at: limit.reset_at });
      }
    } catch (rateErr) {
      console.warn('[wavespeed_proxy] rate limit indisponível:', rateErr.message);
    }

    const body = req.body || {};
    const action = String(body.action || '').trim();

    if (action === 'creator_usage') {
      const email = String(user.email || '').toLowerCase();
      const isAdmin = (user.app_metadata && user.app_metadata.role === 'admin') || OWNER_EMAILS.includes(email);
      if (!isAdmin) return res.status(403).json({ error: 'admin_required' });
      const usage = await getCreatorUsage();
      return res.status(usage.configured === false ? 503 : 200).json(usage);
    }

    if (action === 'creator_generate') {
      const result = await generateCreatorImage(body, user);
      return res.status(result.status).json(result.payload);
    }

    if (action === 'creator_vision') {
      const result = await generateCreatorFromVision(body, user);
      return res.status(result.status).json(result.payload);
    }

    if (action === 'creator_status') {
      const result = await queryCreatorTask(body.task_id);
      return res.status(result.status).json(result.payload);
    }

    if (!WAVESPEED_API_KEY) {
      return res.status(503).json({
        error: 'provider_not_configured',
        message: 'WAVESPEED_API_KEY não configurada no servidor.'
      });
    }

    if (action === 'upload_ticket') {
      const filename = String(body.filename || 'ghostlens_video.mp4').slice(0, 180);
      const size = Number(body.size) || 0;
      if (!size || size > 250 * 1024 * 1024) {
        return res.status(400).json({ error: 'invalid_file_size' });
      }
      const data = await wavespeed('media/uploads', {
        method: 'POST',
        body: JSON.stringify({ filename, size })
      });
      return res.status(200).json({ data: data && data.data ? data.data : data });
    }

    if (action === 'infer') {
      const kind = String(body.kind || 'fps');
      const downloadUrl = String(body.download_url || '');
      if (!isAllowedDownloadUrl(downloadUrl)) {
        return res.status(400).json({ error: 'invalid_download_url' });
      }
      const endpoint = kind === 'upscale'
        ? 'wavespeed-ai/video-upscaler'
        : 'wavespeed-ai/video-fps-increaser';
      const payload = kind === 'upscale'
        ? { video: downloadUrl, target_resolution: '4k' }
        : { video: downloadUrl, target_fps: 60 };
      const data = await wavespeed(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.status(200).json({ data: data && data.data ? data.data : data });
    }

    if (action === 'poll') {
      const pollUrl = String(body.poll_url || '');
      if (!isAllowedPollUrl(pollUrl)) {
        return res.status(400).json({ error: 'invalid_poll_url' });
      }
      const data = await wavespeed(pollUrl.replace(`${WAVESPEED_API}/`, ''), { method: 'GET' });
      return res.status(200).json(data);
    }

    if (action === 'tts') {
      const text = String(body.text || '').trim();
      if (!text || text.length > TTS_MAX_CHARS) {
        return res.status(400).json({ error: 'invalid_tts_text', max_chars: TTS_MAX_CHARS });
      }
      const voice = String(body.voice || 'Vivian');
      if (!TTS_VOICES.has(voice)) {
        return res.status(400).json({ error: 'invalid_tts_voice' });
      }
      const requestedLanguage = String(body.language || 'auto');
      const language = TTS_LANGUAGES.has(requestedLanguage) ? requestedLanguage : 'auto';
      const style = String(body.style || '').slice(0, 300).trim();

      try {
        const limit = await enforceRateLimit(`tts-user:${user.id}`, 10, 600);
        if (!limit.allowed) {
          return res.status(429).json({ error: 'rate_limited', reset_at: limit.reset_at });
        }
      } catch (rateErr) {
        console.warn('[wavespeed_proxy] rate limit TTS indisponível:', rateErr.message);
      }

      const payload = { text, voice, language };
      if (style) payload.style_instruction = style;
      const data = await wavespeed(TTS_MODEL, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.status(200).json({ data: data && data.data ? data.data : data });
    }

    if (action === 'fetch_audio') {
      const audioUrl = String(body.url || '');
      if (!isAllowedDownloadUrl(audioUrl)) {
        return res.status(400).json({ error: 'invalid_audio_url' });
      }
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        return res.status(502).json({ error: 'audio_unavailable' });
      }
      const contentLength = Number(audioRes.headers.get('content-length') || 0);
      if (contentLength > TTS_MAX_AUDIO_BYTES) {
        return res.status(413).json({ error: 'audio_too_large' });
      }
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      if (buffer.length > TTS_MAX_AUDIO_BYTES) {
        return res.status(413).json({ error: 'audio_too_large' });
      }
      res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Content-Length', String(buffer.length));
      return res.status(200).send(buffer);
    }

    return res.status(400).json({ error: 'invalid_action' });
  } catch (err) {
    console.error('[wavespeed_proxy] erro:', err.status || '', err.message);
    return res.status(502).json({ error: 'wavespeed_unavailable' });
  }
};
