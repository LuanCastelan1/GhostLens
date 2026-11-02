// ============================================================================
// GhostLens • Helpers compartilhados das funções serverless (Vercel)
// CommonJS, sem dependências externas. Usa a API REST do Supabase com a
// service_role — nunca exponha essa chave no frontend.
// ============================================================================
'use strict';

const crypto = require('crypto');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co')
  .replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.GHOSTLENS_EMAIL_FROM || 'GhostLens <licencas@ghostlens.cloud>';
const SESSION_SECRET = process.env.GHOSTLENS_SESSION_SECRET || '';
const SESSION_TTL_SECONDS = Math.max(
  300,
  parseInt(process.env.GHOSTLENS_SESSION_TTL || '86400', 10) || 86400
);

const LICENSE_TABLE = 'ghost_licenses';

function backendConfigured() {
  return Boolean(SUPABASE_SERVICE_ROLE_KEY);
}

function requireBackend() {
  if (!backendConfigured()) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
    err.status = 503;
    throw err;
  }
}

async function supabaseRest(path, options = {}) {
  requireBackend();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = new Error(`supabase_http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function generateLicenseKey(code) {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GHOST-${code}-${part()}-${part()}-${part()}`;
}

function planForAmountBRL(amount) {
  const value = Number(amount) || 0;
  if (value < 70) {
    return { code: 'SOLO', plan: 'GhostLens Solo (1 Dispositivo)', maxDevices: 1 };
  }
  if (value >= 200) {
    return { code: 'AGENCY', plan: 'GhostLens Agency (10 Dispositivos)', maxDevices: 10 };
  }
  return { code: 'PRO', plan: 'GhostLens Pro (3 Dispositivos)', maxDevices: 3 };
}

function expiresInDays(days) {
  return new Date(Date.now() + Number(days || 30) * 86400 * 1000).toISOString();
}

function safeEqualStr(a, b) {
  const left = Buffer.from(String(a == null ? '' : a));
  const right = Buffer.from(String(b == null ? '' : b));
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function isValidKeyShape(key) {
  return /^GHOST-(SOLO|PRO|AGENCY|MASTER)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key);
}

async function findLicenseByPaymentId(paymentId) {
  if (!paymentId) return null;
  const rows = await supabaseRest(
    `${LICENSE_TABLE}?payment_id=eq.${encodeURIComponent(paymentId)}&select=*`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function findLicenseByKey(key) {
  const rows = await supabaseRest(
    `${LICENSE_TABLE}?key=eq.${encodeURIComponent(key)}&select=*`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Cria a licença de forma idempotente. Se o payment_id já existir, devolve a
 * licença original em vez de gerar outra chave para o mesmo pagamento.
 */
async function createOrGetLicense({
  email,
  amountBRL,
  provider,
  paymentId,
  days = 30,
  code,
  plan,
  maxDevices
}) {
  const existing = await findLicenseByPaymentId(paymentId);
  if (existing) return existing;

  const tier = code
    ? { code, plan, maxDevices }
    : planForAmountBRL(amountBRL);

  const record = {
    key: generateLicenseKey(tier.code),
    email: String(email || '').trim(),
    plan: tier.plan,
    code: tier.code,
    max_devices: tier.maxDevices,
    provider,
    payment_id: paymentId || null,
    amount_brl: Number.isFinite(Number(amountBRL)) ? Number(amountBRL) : null,
    status: 'active',
    expires_at: expiresInDays(days)
  };

  try {
    const inserted = await supabaseRest(LICENSE_TABLE, {
      method: 'POST',
      body: JSON.stringify([record])
    });
    return Array.isArray(inserted) ? inserted[0] : null;
  } catch (err) {
    // Corrida entre dois webhooks do mesmo pagamento: devolve o registro vencedor.
    if ((err.status === 409 || err.status === 400) && paymentId) {
      const winner = await findLicenseByPaymentId(paymentId);
      if (winner) return winner;
    }
    throw err;
  }
}

function normalizeLicense(row) {
  return {
    key: row.key,
    email: row.email,
    plan: row.plan,
    code: row.code,
    max_devices: row.max_devices,
    provider: row.provider,
    status: row.status,
    target_hwid: row.target_hwid || null,
    expires_at: Math.floor(new Date(row.expires_at).getTime() / 1000),
    created_at: row.created_at,
    bound_at: row.bound_at || null
  };
}

async function sendLicenseEmail(license) {
  const target = String((license && license.email) || '').trim();
  if (!target || !target.includes('@')) {
    console.warn('[GhostLens] Licença sem e-mail de cliente — envio ignorado.');
    return { sent: false, reason: 'no_customer_email' };
  }

  if (!RESEND_API_KEY) {
    console.warn('[GhostLens] RESEND_API_KEY ausente — licença emitida, e-mail não enviado.');
    return { sent: false, reason: 'email_not_configured' };
  }

  const expiry = new Date(license.expires_at).toLocaleDateString('pt-BR');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 8px">Sua licença GhostLens</h2>
      <p style="color:#555">Pagamento confirmado. Aqui está sua chave de ativação:</p>
      <p style="font-family:monospace;font-size:20px;font-weight:bold;background:#f4f4f5;padding:14px;border-radius:8px;text-align:center">${license.key}</p>
      <p><strong>Plano:</strong> ${license.plan}<br>
         <strong>Dispositivos:</strong> ${license.max_devices}<br>
         <strong>Validade:</strong> ${expiry}</p>
      <p style="color:#555">Abra o GhostLens Desktop, cole a chave no assistente de ativação e o ambiente
         será vinculado à sua máquina.</p>
      <p style="color:#999;font-size:12px">Se você não fez esta compra, responda este e-mail.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [target],
        subject: `Sua licença GhostLens • ${license.code}`,
        html
      })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[GhostLens] Falha ao enviar e-mail:', res.status, body.slice(0, 300));
      return { sent: false, reason: `resend_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('[GhostLens] Erro de rede ao enviar e-mail:', err.message);
    return { sent: false, reason: 'email_network_error' };
  }
}

/**
 * Lê o corpo bruto da requisição. A verificação de assinatura do Stripe exige
 * os bytes exatos. Na Vercel o body pode chegar já parseado; nesse caso o
 * fallback re-serializa o JSON (funciona para payloads compactos).
 */
async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.rawBody) {
    return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
  }
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body));
  }
  if (req && typeof req.on === 'function') {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  return Buffer.from('');
}

/**
 * Verifica o header stripe-signature (t=...,v1=...).
 * Documentação: https://docs.stripe.com/webhooks/signatures
 */
function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;

  const parts = String(signatureHeader).split(',').reduce((acc, item) => {
    const idx = item.indexOf('=');
    if (idx > 0) {
      const k = item.slice(0, idx).trim();
      const v = item.slice(idx + 1).trim();
      if (!acc[k]) acc[k] = [];
      acc[k].push(v);
    }
    return acc;
  }, {});

  const timestamp = parts.t ? parts.t[0] : null;
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');

  return signatures.some((sig) => safeEqualStr(sig, expected));
}

function setCors(res, allowedHeaders = 'Content-Type') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
  res.setHeader('Cache-Control', 'no-store');
}

// ── Sessão server-side (JWT HS256, curto) ──────────────────────────────────

function base64url(bufferOrString) {
  return Buffer.from(bufferOrString).toString('base64url');
}

function sessionConfigured() {
  return Boolean(SESSION_SECRET && SESSION_SECRET.length >= 32);
}

function signSession(claims) {
  if (!sessionConfigured()) {
    const err = new Error('GHOSTLENS_SESSION_SECRET ausente ou curto');
    err.status = 503;
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...claims,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: crypto.randomBytes(12).toString('hex')
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return {
    token: `${header}.${body}.${signature}`,
    payload,
    expires_at: payload.exp
  };
}

function verifySession(token) {
  if (!sessionConfigured()) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (!safeEqualStr(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (!payload.sub || !payload.hwid) return null;
  return payload;
}

function getClientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '');
  const ip = raw.split(',')[0].trim();
  if (ip) return ip;
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return 'unknown';
}

async function enforceRateLimit(bucket, limit, windowSeconds) {
  const result = await supabaseRest('rpc/check_rate_limit', {
    method: 'POST',
    body: JSON.stringify({
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds
    })
  });
  return {
    allowed: Boolean(result && result.allowed),
    reset_at: result && result.reset_at
  };
}

module.exports = {
  SUPABASE_URL,
  LICENSE_TABLE,
  SESSION_TTL_SECONDS,
  backendConfigured,
  sessionConfigured,
  supabaseRest,
  generateLicenseKey,
  planForAmountBRL,
  expiresInDays,
  safeEqualStr,
  isValidKeyShape,
  findLicenseByKey,
  findLicenseByPaymentId,
  createOrGetLicense,
  normalizeLicense,
  sendLicenseEmail,
  readRawBody,
  verifyStripeSignature,
  setCors,
  signSession,
  verifySession,
  getClientIp,
  enforceRateLimit
};
