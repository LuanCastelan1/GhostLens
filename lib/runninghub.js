// ============================================================================
// GhostLens • RunningHub workflow adapter
//
// Cada IA do GhostCreator é um workflow publicado no RunningHub.
// O cliente nunca vê workflowId, ComfyUI, nodeId ou safetensors.
//
// Env:
//   RUNNINGHUB_API_KEY        chave da API
//   RUNNINGHUB_BASE_URL       default https://www.runninghub.cn
//   RUNNINGHUB_WORKFLOWS      JSON inline (opcional)
//   RUNNINGHUB_WORKFLOWS_FILE caminho do JSON (default RUNNINGHUB_WORKFLOWS.json)
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { storeMedia } = require('./storage');

const RUNNINGHUB_API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const RUNNINGHUB_BASE_URL = (process.env.RUNNINGHUB_BASE_URL || 'https://www.runninghub.cn').replace(/\/+$/, '');
const DEFAULT_INSTANCE = process.env.RUNNINGHUB_INSTANCE_TYPE || 'plus';

// GhostFlash = prioridade alta (fila pessoal/instância maior)
// GhostLite  = fila econômica (instância padrão)
const SPEED_MODE_CONFIG = {
  ghostflash: { instanceType: 'ultra', usePersonalQueue: true },
  ghostlite: { instanceType: 'default', usePersonalQueue: false }
};

function parseRegistry(raw) {
  if (!raw || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('[runninghub] registry inválido:', err.message);
    return {};
  }
}

function loadRegistry() {
  let registry = {};
  try {
    const file = process.env.RUNNINGHUB_WORKFLOWS_FILE || path.join(process.cwd(), 'RUNNINGHUB_WORKFLOWS.json');
    if (fs.existsSync(file)) {
      registry = { ...registry, ...parseRegistry(fs.readFileSync(file, 'utf8')) };
    }
  } catch (err) {
    console.warn('[runninghub] registry file:', err.message);
  }
  if (process.env.RUNNINGHUB_WORKFLOWS) {
    registry = { ...registry, ...parseRegistry(process.env.RUNNINGHUB_WORKFLOWS) };
  }
  return registry;
}

function getRunningHubCatalog() {
  const registry = loadRegistry();
  return Object.entries(registry).map(([id, cfg]) => ({
    id,
    name: cfg.name || id,
    provider: 'runninghub',
    mode: cfg.mode || 'image',
    tags: Array.isArray(cfg.tags) ? cfg.tags : [],
    credits: Number(cfg.credits) || 0,
    cost_label: cfg.cost_label || `${Number(cfg.credits) || 0} créditos`,
    status: cfg.workflowId ? 'live' : 'draft',
    badge: cfg.badge || cfg.name || id,
    button: cfg.button || 'Gerar',
    control: cfg.control || '',
    description: cfg.description || '',
    speed_modes: Array.isArray(cfg.speedModes) ? cfg.speedModes : ['ghostflash', 'ghostlite'],
    default_speed_mode: cfg.defaultSpeedMode || 'ghostflash',
    speed_mode_credits: cfg.speedModeCredits || {},
    speed_instance_types: cfg.speedInstanceTypes || {},
    supports_swap: Boolean(cfg.swapInputs),
    vision_ready: Boolean(cfg.vision && cfg.vision.enabled !== false),
    result_mode: cfg.resultMode || 'image',
    required_assets: Array.isArray(cfg.requiredAssets) ? cfg.requiredAssets : []
  }));
}

function parseAssetDataUrl(dataUrl) {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('invalid_asset');
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('invalid_asset_size');
  return { buffer, contentType };
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/quicktime') return 'mov';
  if (contentType === 'application/zip' || contentType === 'application/x-zip-compressed') return 'zip';
  return 'jpg';
}

function makeForm(buffer, contentType, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  return form;
}

async function uploadAsset(dataUrl, kind = 'image') {
  const { buffer, contentType } = parseAssetDataUrl(dataUrl);
  const limit = kind === 'video' ? 100 * 1024 * 1024 : (kind === 'zip' ? 50 * 1024 * 1024 : 20 * 1024 * 1024);
  if (buffer.length > limit) throw new Error('asset_too_large');
  const filename = `ghostlens-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${extensionFor(contentType)}`;

  // v2 upload: retorna download_url (para nós LoadImageFromUrl)
  const res = await fetch(`${RUNNINGHUB_BASE_URL}/openapi/v2/media/upload/binary`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RUNNINGHUB_API_KEY}` },
    body: makeForm(buffer, contentType, filename)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.ok && data && data.code === 0 && data.data) {
    const value = data.data.download_url || data.data.fileName || data.data.file_name;
    if (value) {
      return {
        value,
        url: data.data.download_url || value,
        fileName: data.data.fileName || data.data.file_name || null,
        contentType
      };
    }
  }

  // Fallback legacy: retorna fileName (para nós LoadImage / VHS_LoadVideo / RHUploadZip)
  const legacy = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RUNNINGHUB_API_KEY}` },
    body: makeForm(buffer, contentType, filename)
  });
  const legacyText = await legacy.text();
  let legacyData = null;
  try { legacyData = legacyText ? JSON.parse(legacyText) : null; } catch { legacyData = null; }
  if (legacy.ok && legacyData && legacyData.code === 0 && legacyData.data) {
    const value = legacyData.data.fileName || legacyData.data.file_name || legacyData.data.download_url;
    if (value) {
      return {
        value,
        url: legacyData.data.download_url || value,
        fileName: legacyData.data.fileName || legacyData.data.file_name || null,
        contentType
      };
    }
  }

  throw new Error(`runninghub_upload_failed_${res.status}`);
}

function pickAsset(assets, key) {
  return assets[key] || null;
}

function assetValueFor(mapping, asset) {
  if (!asset) return undefined;
  return mapping.assetValue === 'fileName' ? asset.fileName : asset.value;
}

function buildNodeInfoList(config, body, assets) {
  const list = [];
  const inputs = config.inputs || {};

  for (const [key, mapping] of Object.entries(inputs)) {
    if (!mapping || !mapping.nodeId || !mapping.fieldName) continue;
    let value;

    if (mapping.source === 'prompt' || key === 'prompt') {
      value = body.prompt;
    } else if (mapping.source === 'negative_prompt' || key === 'negative_prompt') {
      value = body.negative_prompt;
    } else if (mapping.assetKey) {
      value = assetValueFor(mapping, pickAsset(assets, mapping.assetKey));
    } else if (mapping.asset === 'image' || key === 'image') {
      value = assetValueFor(mapping, assets.image || assets.reference_1);
    } else if (key.startsWith('reference_')) {
      value = assetValueFor(mapping, assets[key] || assets[`reference_${Number(key.split('_')[1]) || 1}`]);
    } else if (mapping.asset === 'zip' || key === 'zip') {
      value = assetValueFor(mapping, assets.zip);
    } else if (mapping.asset === 'video' || key === 'video' || key === 'motion_video') {
      value = assetValueFor(mapping, assets.motion_video || assets.video);
    } else if (mapping.asset === 'lora' || key === 'lora' || key === 'lora_name') {
      value = body.lora_file || body.lora_name || config.defaultLora || '';
    } else if (key === 'lora_weight' || key === 'strength_model') {
      value = body.lora_weight !== undefined ? Number(body.lora_weight) : (config.defaultLoraWeight || 1.0);
    } else if (key === 'seed') {
      value = body.seed !== undefined ? Number(body.seed) : Math.floor(Math.random() * 1000000000);
    } else {
      value = body[key];
    }

    if ((value === undefined || value === null || value === '') && mapping.default !== undefined) {
      value = mapping.default;
    }
    if (value === undefined || value === null || value === '') continue;
    if (mapping.type === 'number' || ['lora_weight', 'seed', 'width', 'height', 'length', 'duration', 'batch_size', 'steps', 'control_strength'].includes(key)) {
      value = Number(value);
    }
    list.push({ nodeId: String(mapping.nodeId), fieldName: String(mapping.fieldName), fieldValue: value });
  }

  // Flags de swap/retoque definidas no workflow (remove_tattoos, remove_watermark etc.)
  if (config.swapInputs && typeof config.swapInputs === 'object') {
    for (const [flag, mapping] of Object.entries(config.swapInputs)) {
      if (!mapping || !mapping.nodeId || !mapping.fieldName) continue;
      if (body[flag] === undefined) continue;
      list.push({
        nodeId: String(mapping.nodeId),
        fieldName: String(mapping.fieldName),
        fieldValue: Boolean(body[flag])
      });
    }
  }

  // Overrides estáticos opcionais (presets de lente, sampler etc.)
  if (Array.isArray(config.extraNodes)) {
    for (const node of config.extraNodes) {
      if (node && node.nodeId && node.fieldName) {
        list.push({ nodeId: String(node.nodeId), fieldName: String(node.fieldName), fieldValue: node.fieldValue });
      }
    }
  }

  return list;
}

async function buildAssets(config, body) {
  const assets = {};
  if (config.assets && typeof config.assets === 'object') {
    for (const [assetKey, spec] of Object.entries(config.assets)) {
      const bodyKey = spec.bodyKey || assetKey;
      const raw = body[bodyKey];
      if (!raw) continue;
      assets[assetKey] = await uploadAsset(raw, spec.type || 'image');
    }
  }

  const references = Array.isArray(body.references) ? body.references : [];
  for (let index = 0; index < references.length; index += 1) {
    const key = `reference_${index + 1}`;
    if (!assets[key]) assets[key] = await uploadAsset(references[index], 'image');
  }
  if (!assets.image && assets.reference_1) assets.image = assets.reference_1;
  return assets;
}

async function startRunningHubWorkflow(body, user) {
  if (!RUNNINGHUB_API_KEY) {
    return {
      status: 503,
      payload: { error: 'provider_not_configured', message: 'RUNNINGHUB_API_KEY ainda não configurada no servidor.' }
    };
  }

  const registry = loadRegistry();
  const key = String(body.workflow_key || body.model || '').trim();
  const config = registry[key];

  if (!config || !config.workflowId) {
    return {
      status: 503,
      payload: { error: 'workflow_not_configured', message: `O workflow "${key}" ainda não está publicado/configurado.` }
    };
  }

  try {
    const assets = await buildAssets(config, body);

    const requiredAssets = Array.isArray(config.requiredAssets) ? config.requiredAssets : [];
    for (const required of requiredAssets) {
      if (!assets[required]) {
        return {
          status: 400,
          payload: { error: 'missing_asset', asset: required, message: `Envie o arquivo obrigatório: ${required}.` }
        };
      }
    }

    const references = Array.isArray(body.references) ? body.references : [];
    if (!references.length && !Object.keys(assets).length && config.requiresReference !== false) {
      return {
        status: 400,
        payload: { error: 'reference_required', message: 'Envie ao menos uma foto de referência da musa.' }
      };
    }

    const nodeInfoList = buildNodeInfoList(config, body, assets);
    if (!nodeInfoList.length) {
      return {
        status: 400,
        payload: { error: 'workflow_inputs_not_configured', message: 'O workflow não tem mapeamento de inputs configurado.' }
      };
    }

    const speedMode = String(body.speed_mode || config.defaultSpeedMode || 'ghostflash').toLowerCase();
    const speed = SPEED_MODE_CONFIG[speedMode] || {};
    const resolvedInstance = (config.speedInstanceTypes && config.speedInstanceTypes[speedMode])
      || config.instanceType
      || speed.instanceType
      || DEFAULT_INSTANCE;

    const submitRes = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        apiKey: RUNNINGHUB_API_KEY,
        workflowId: String(config.workflowId),
        nodeInfoList,
        instanceType: resolvedInstance,
        usePersonalQueue: speed.usePersonalQueue !== undefined
          ? speed.usePersonalQueue
          : Boolean(config.usePersonalQueue)
      })
    });
    const submitText = await submitRes.text();
    let submitData = null;
    try { submitData = submitText ? JSON.parse(submitText) : null; } catch { submitData = null; }

    if (!submitRes.ok || !submitData || submitData.code !== 0 || !submitData.data || !submitData.data.taskId) {
      console.error('[runninghub] submit:', submitRes.status, submitText.slice(0, 300));
      return {
        status: 502,
        payload: {
          error: 'provider_error',
          message: (submitData && (submitData.msg || submitData.message)) || 'O RunningHub recusou o workflow.'
        }
      };
    }

    return {
      status: 200,
      payload: {
        provider: 'runninghub',
        status: 'processing',
        task_id: String(submitData.data.taskId),
        workflow_key: key,
        speed_mode: speedMode,
        speed_mode_credits: config.speedModeCredits ? Number(config.speedModeCredits[speedMode]) || 0 : 0,
        credits: Number(config.credits) || 0,
        result_mode: config.resultMode || 'image',
        provider_cost: submitData.data.consumeCoins || submitData.data.consumeMoney || null
      }
    };
  } catch (err) {
    console.error('[runninghub] start:', err.message);
    return {
      status: 502,
      payload: { error: 'generation_failed', message: err.message || 'Falha ao iniciar o workflow.' }
    };
  }
}

function extractUrls(results) {
  const urls = [];
  if (!Array.isArray(results)) return urls;
  for (const item of results) {
    if (!item) continue;
    if (typeof item === 'string' && /^https?:\/\//.test(item)) {
      urls.push(item);
      continue;
    }
    const value = item.url || item.outputUrl || item.fileUrl;
    if (value && /^https?:\/\//.test(value)) urls.push(value);
  }
  return [...new Set(urls)];
}

async function downloadAndStore(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download_${res.status}`);
  const contentType = String(res.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  const stored = await storeMedia(buffer, contentType || 'application/octet-stream');
  return { ...stored, source_url: url };
}

async function queryRunningHubTask(taskId) {
  if (!RUNNINGHUB_API_KEY) {
    return { status: 503, payload: { error: 'provider_not_configured', message: 'RUNNINGHUB_API_KEY ainda não configurada.' } };
  }
  if (!taskId) {
    return { status: 400, payload: { error: 'task_id_required' } };
  }

  try {
    const res = await fetch(`${RUNNINGHUB_BASE_URL}/openapi/v2/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ taskId: String(taskId) })
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok || !data) {
      return { status: 502, payload: { error: 'provider_error', message: 'Falha ao consultar o RunningHub.' } };
    }

    const status = String(data.status || (data.data && data.data.taskStatus) || data.taskStatus || '').toUpperCase();
    const results = data.results || (data.data && data.data.results) || [];
    const providerCost = data.consumeCoins || data.consumeMoney || (data.data && (data.data.consumeCoins || data.data.consumeMoney)) || null;

    if (status === 'SUCCESS') {
      const urls = extractUrls(results).slice(0, 20);
      if (!urls.length) {
        return { status: 502, payload: { error: 'empty_result', message: 'O RunningHub não retornou mídia.', task_id: taskId } };
      }

      const media = [];
      for (const url of urls) {
        try {
          media.push(await downloadAndStore(url));
        } catch (err) {
          console.warn('[runninghub] download/storage:', err.message);
          const guessedType = /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'image';
          media.push({ url, media_type: guessedType, content_type: '', source_url: url });
        }
      }

      const firstImage = media.find((m) => m.media_type === 'image');
      const firstVideo = media.find((m) => m.media_type === 'video');

      return {
        status: 200,
        payload: {
          status: 'success',
          task_id: String(taskId),
          media,
          media_urls: media.map((m) => m.url),
          image_url: firstImage ? firstImage.url : undefined,
          video_url: firstVideo ? firstVideo.url : undefined,
          media_type: firstVideo ? 'video' : 'image',
          provider_cost: providerCost
        }
      };
    }

    if (status === 'FAILED' || status === 'CANCEL') {
      return {
        status: 200,
        payload: {
          status: 'failed',
          task_id: String(taskId),
          error: 'workflow_failed',
          message: data.msg || (data.data && data.data.errorMessage) || 'O workflow falhou.'
        }
      };
    }

    return {
      status: 200,
      payload: { status: 'processing', task_id: String(taskId), task_status: status || 'QUEUED', provider_cost: providerCost }
    };
  } catch (err) {
    console.error('[runninghub] query:', err.message);
    return { status: 502, payload: { error: 'query_failed', message: err.message } };
  }
}

module.exports = {
  getRunningHubCatalog,
  startRunningHubWorkflow,
  queryRunningHubTask,
  runningHubConfigured: Boolean(RUNNINGHUB_API_KEY)
};
