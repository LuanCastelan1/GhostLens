// ============================================================================
// GhostLens • GhostCreator provider adapter
//
// Executado pelo endpoint /api/wavespeed_proxy com action=creator_generate.
// Mantém o token da useapi somente no servidor.
// ============================================================================
'use strict';

const { enforceRateLimit } = require('./ghostlens-backend');
const { storeImage } = require('./storage');
const {
  getRunningHubCatalog,
  startRunningHubWorkflow,
  queryRunningHubTask,
  getRunningHubAccountStatus,
  runningHubConfigured
} = require('./runninghub');
const { analyzeComposition, visionConfigured } = require('./vision');

const USEAPI_TOKEN = process.env.USEAPI_TOKEN || '';
const USEAPI_ACCOUNT_EMAIL = (process.env.USEAPI_ACCOUNT_EMAIL || '').trim();
const USEAPI_API = 'https://api.useapi.net/v1/google-flow';

const MODEL_MAP = {
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

function getCreatorCatalog() {
  const models = [];
  if (USEAPI_TOKEN) {
    models.push(
      {
        id: 'nanobanana_21',
        name: 'Nano Banana 2.1',
        provider: 'useapi',
        mode: 'image',
        tags: ['Refs', '2K', 'Rápido'],
        credits: 0,
        cost_label: 'Incluso no Pro',
        status: 'live',
        badge: 'Nano Banana 2.1',
        button: 'Gerar com Nano Banana'
      },
      {
        id: 'nanobanana_lite',
        name: 'Nano Banana 2 Lite',
        provider: 'useapi',
        mode: 'image',
        tags: ['Refs', 'Instantâneo'],
        credits: 0,
        cost_label: 'Incluso no Pro',
        status: 'live',
        badge: 'Nano Banana 2 Lite',
        button: 'Gerar com Nano Banana Lite'
      },
      {
        id: 'nanobanana_pro',
        name: 'Nano Banana Pro 2K',
        provider: 'useapi',
        mode: 'image',
        tags: ['Refs', '2K'],
        credits: 5,
        cost_label: '5 créditos',
        status: 'live',
        badge: 'Nano Banana Pro 2K',
        button: 'Gerar em 2K'
      }
    );
  }
  if (runningHubConfigured) {
    models.push(...getRunningHubCatalog().filter((m) => m.status === 'live'));
  }
  models.push({
    id: 'chatgpt_import',
    name: 'Importar do ChatGPT',
    provider: 'local',
    mode: 'image',
    tags: ['Import', 'Grátis'],
    credits: 0,
    cost_label: 'Grátis',
    status: 'live',
    badge: 'Importar do ChatGPT',
    button: 'Importar Imagem',
    control: 'chatgpt'
  });
  return models;
}

async function generateCreatorImage(body, user) {
  const provider = String(body.provider || '').trim().toLowerCase();
  const workflowKey = String(body.workflow_key || '').trim();
  if (provider === 'runninghub' || workflowKey) {
    return startRunningHubWorkflow({ ...body, workflow_key: workflowKey || body.model }, user);
  }

  if (!USEAPI_TOKEN) {
    return {
      status: 503,
      payload: { error: 'provider_not_configured', message: 'Nenhum provedor configurado. Configure USEAPI_TOKEN ou RUNNINGHUB_API_KEY.' }
    };
  }

  const model = String(body.model || '').trim();
  if (model === 'eros_image_2k') {
    return {
      status: 503,
      payload: { error: 'workflow_not_configured', message: 'Eros-Image 2K ainda não está conectado ao RunningHub.' }
    };
  }
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

async function generateCreatorFromVision(body, user) {
  const workflowKey = String(body.workflow_key || body.model || '').trim();
  if (!workflowKey) {
    return { status: 400, payload: { error: 'workflow_key_required' } };
  }

  try {
    const analysis = await analyzeComposition({
      image_url: body.image_url,
      image_base64: body.image_base64,
      persona_dna: body.persona_dna,
      persona_name: body.persona_name
    });

    // O prompt final é montado aqui e nunca volta para o frontend.
    return await startRunningHubWorkflow({
      ...body,
      workflow_key: workflowKey,
      prompt: analysis.prompt,
      references: Array.isArray(body.references) ? body.references : []
    }, user);
  } catch (err) {
    return {
      status: err.status || 500,
      payload: { error: err.code || 'vision_failed', message: err.message || 'Falha no agente de visão.' }
    };
  }
}

async function queryCreatorTask(taskId) {
  return queryRunningHubTask(taskId);
}

async function getCreatorUsage() {
  return getRunningHubAccountStatus();
}

module.exports = {
  generateCreatorImage,
  generateCreatorFromVision,
  queryCreatorTask,
  getCreatorCatalog,
  getCreatorUsage,
  creatorConfigured: Boolean(USEAPI_TOKEN || runningHubConfigured),
  visionConfigured
};
