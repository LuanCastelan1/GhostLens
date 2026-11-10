// ============================================================================
// GhostLens • Supabase Storage helper
// ============================================================================
'use strict';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORAGE_BUCKET = 'ghost-creator';

async function ensureBucket() {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('storage_not_configured');
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
    console.warn('[storage] bucket:', err.message);
  }
}

async function storeImage(buffer, contentType = 'image/jpeg') {
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

module.exports = { storeImage, ensureBucket, STORAGE_BUCKET };
