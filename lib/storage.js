// ============================================================================
// GhostLens • Supabase Storage helper (imagens e vídeos)
// ============================================================================
'use strict';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mbelyevitfksmknlyhgr.supabase.co').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const IMAGE_BUCKET = 'ghost-creator';
const VIDEO_BUCKET = 'ghost-creator-video';

async function ensureBucket(bucket = IMAGE_BUCKET, fileSizeLimit = 15728640) {
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
        id: bucket,
        name: bucket,
        public: false,
        file_size_limit: fileSizeLimit
      })
    });
  } catch (err) {
    console.warn('[storage] bucket:', err.message);
  }
}

async function signPath(bucket, path) {
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
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

async function storeMedia(buffer, contentType = 'image/jpeg') {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('storage_not_configured');
  const type = String(contentType || '').split(';')[0].toLowerCase();
  const isVideo = type.startsWith('video/');
  const bucket = isVideo ? VIDEO_BUCKET : IMAGE_BUCKET;
  const limit = isVideo ? 52428800 : 15728640;

  if (buffer.length > limit) throw new Error('storage_file_too_large');
  await ensureBucket(bucket, limit);

  let ext = 'jpg';
  if (type === 'image/png') ext = 'png';
  else if (type === 'image/webp') ext = 'webp';
  else if (type === 'video/webm') ext = 'webm';
  else if (type === 'video/quicktime') ext = 'mov';
  else if (type === 'video/mp4') ext = 'mp4';

  const folder = isVideo ? 'videos' : 'personas';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': type || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!upload.ok) {
    const detail = await upload.text().catch(() => '');
    throw new Error(`storage_upload_${upload.status}_${detail.slice(0, 120)}`);
  }
  return {
    url: await signPath(bucket, path),
    media_type: isVideo ? 'video' : 'image',
    content_type: type
  };
}

async function storeImage(buffer, contentType = 'image/jpeg') {
  const stored = await storeMedia(buffer, contentType);
  return stored.url;
}

module.exports = {
  storeMedia,
  storeImage,
  ensureBucket,
  STORAGE_BUCKET: IMAGE_BUCKET,
  IMAGE_BUCKET,
  VIDEO_BUCKET
};
