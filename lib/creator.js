// ============================================================================
// GhostLens • GhostCreator provider adapter
//
// Executado pelo endpoint /api/wavespeed_proxy com action=creator_generate.
// Mantém o token da useapi somente no servidor.
// ============================================================================
'use strict';

const { enforceRateLimit } = require('./ghostlens-backend');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USEAPI_TOKEN = process.env.USEAPI_TOKEN || '';
const USEAPI_ACCOUNT_EMAIL = (process.env.USEAPI_ACCOUNT_EMAIL || '').trim();
const USEAPI_API = 'https://api.useapi.net/v1/google-flow';
const STORAGE_BUCKET = 'ghost-creator';

const MODEL_MAP = {
  eros_image_2k: 'nano-banana-pro',
  nanobanana_lite: 'nano-banana-2-lite',
  nanobanana_21: 'nano-banana-2',
  nanobanana_pro: 'nano-banana-pro'
};

function mapAspect(value) {
  const ratio = String(value || '9:16');
  if (ratio === '4:5') return '3:4';
  return ['16:9', '4:3', '1:1', '3:4', '9:16'].includes(ratio) ? ratio : '9:16';
}

async function uploadReference(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('invalid_reference');
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('invalid_reference_size');

  const emailPath = USEAPI_ACCOUNT_EMAIL ? `/${encodeURIComponent(USEAPI_ACCOUNT_EMAIL)}` : '';
  const res = await fetch(`${USEAPI_API}/assets${emailPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${USEAPI_TOKEN}`,
      'Content-Type': contentType
    },
    body: buffer
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error(`useapi_asset_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data && data.mediaGenerationId && data.mediaGenerationId.mediaGenerationId
    ? data.mediaGenerationId.mediaGenerationId
    : (data && data.mediaGenerationId) || null;
}

async function ensureBucket() {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: STORAGE_BUCKET,
        name: STORAGE_BUCKET,
        public: false,
        file_size_limit: 15728640
      })
    });
  } catch (err) {
    console.warn('[creator] bucket:', err.message);
  }
}

async function storeImage(buffer, contentType) {
  await ensureBucket();
  const ext = contentType === 'image/png' ? 'png' : (contentType === 'image/webp' ? 'webp' : 'jpg');
  const path = `personas/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!upload.ok) {
    const detail = await upload.text().catch(() => '');
    throw new Error(`storage_upload_${upload.status}_${detail.slice(0, 120)}`);
  }
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${STORAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: 604800 })
  });
  if (!sign.ok) throw new Error(`storage_sign_${sign.status}`);
  const signed = await sign.json();
  return `${SUPABASE_URL}${signed.signedURL}`;
}

async function generateCreatorImage(body, user) {
  if (!USEAPI_TOKEN) {
    return {
      status: 503,
      payload: { error: 'provider_not_configured', message: 'USEAPI_TOKEN ainda não configurado no servidor.' }
    };
  }

  const model = String(body.model || '').trim();
  const prompt = String(body.prompt || '').trim();
  const aspect = mapAspect(body.aspect_ratio);
  const references = Array.isArray(body.references) ? body.references.slice(0, 10) : [];

  if (model === 'higgsfield_video') {
    return {
      status: 503,
      payload: { error: 'provider_not_configured', message: 'Higgsfield ainda não está conectado. As imagens já funcionam pelo useapi.' }
    };
  }
  if (!MODEL_MAP[model]) {
    return { status: 400, payload: { error: 'invalid_model' } };
  }
  if (!prompt || prompt.length > 3000) {
    return { status: 400, payload: { error: 'invalid_prompt' } };
  }
  if (!references.length) {
    return { status: 400, payload: { error: 'reference_required', message: 'Envie ao menos uma foto de referência da musa.' } };
  }
  if (!USEAPI_ACCOUNT_EMAIL) {
    return {
      status: 503,
      payload: { error: 'provider_not_configured', message: 'USEAPI_ACCOUNT_EMAIL ainda não configurado no servidor.' }
    };
  }

  try {
    const limit = await enforceRateLimit(`creator-user:${user.id}`, 30, 600);
    if (!limit.allowed) {
      return { status: 429, payload: { error: 'rate_limited', reset_at: limit.reset_at } };
    }
  } catch (rateErr) {
    console.warn('[creator] rate limit indisponível:', rateErr.message);
  }

  const referenceIds = [];
  for (const ref of references) {
    const id = await uploadReference(ref);
    if (id) referenceIds.push(id);
  }
  if (!referenceIds.length) {
    return { status: 502, payload: { error: 'reference_upload_failed', message: 'Não foi possível enviar as referências para a useapi.' } };
  }

  const payload = {
    prompt,
    model: MODEL_MAP[model],
    aspectRatio: aspect,
    count: 1
  };
  referenceIds.forEach((id, index) => {
    payload[`reference_${index + 1}`] = id;
  });

  const apiRes = await fetch(`${USEAPI_API}/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${USEAPI_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await apiRes.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!apiRes.ok) {
    console.error('[creator] useapi:', apiRes.status, text.slice(0, 300));
    return {
      status: 502,
      payload: {
        error: 'provider_error',
        message: data && data.error ? String(data.error) : 'A useapi recusou a geração.'
      }
    };
  }

  const media = (data && Array.isArray(data.media)) ? data.media : [];
  let imageUrl = '';
  let imageBase64 = '';
  for (const item of media) {
    const generated = item && item.image && item.image.generatedImage;
    if (!generated) continue;
    if (generated.fifeUrl) {
      try {
        const dl = await fetch(generated.fifeUrl);
        if (dl.ok) {
          const contentType = dl.headers.get('content-type') || 'image/jpeg';
          const buffer = Buffer.from(await dl.arrayBuffer());
          if (buffer.length <= 15 * 1024 * 1024) {
            imageUrl = await storeImage(buffer, contentType.split(';')[0]);
          }
        }
      } catch (err) {
        console.warn('[creator] download/storage:', err.message);
      }
      if (!imageUrl) imageUrl = generated.fifeUrl;
    } else if (generated.encodedImage) {
      imageBase64 = generated.encodedImage;
      try {
        const buffer = Buffer.from(generated.encodedImage, 'base64');
        imageUrl = await storeImage(buffer, 'image/jpeg');
      } catch (err) {
        console.warn('[creator] storage encoded:', err.message);
      }
    }
    if (imageUrl || imageBase64) break;
  }

  if (!imageUrl && !imageBase64) {
    return { status: 502, payload: { error: 'empty_result', message: 'A useapi não retornou imagem.' } };
  }

  return {
    status: 200,
    payload: {
      provider: 'useapi',
      model: MODEL_MAP[model],
      image_url: imageUrl || undefined,
      image_base64: imageUrl ? undefined : imageBase64
    }
  };
}

module.exports = {
  generateCreatorImage,
  creatorConfigured: Boolean(USEAPI_TOKEN)
};
