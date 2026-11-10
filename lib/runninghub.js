// ============================================================================
// GhostLens • RunningHub workflow adapter
//
// Cada IA do GhostCreator é um workflow publicado no RunningHub.
// O cliente nunca vê workflowId, ComfyUI, nodeId ou safetensors.
//
// Env:
//   RUNNINGHUB_API_KEY   chave da API
//   RUNNINGHUB_BASE_URL  default https://www.runninghub.cn
//   RUNNINGHUB_WORKFLOWS JSON com o registry de workflows (ver README)
// ============================================================================
'use strict';

const { storeImage } = require('./storage');

const RUNNINGHUB_API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const RUNNINGHUB_BASE_URL = (process.env.RUNNINGHUB_BASE_URL || 'https://www.runninghub.cn').replace(/\/+$/, '');
const DEFAULT_INSTANCE = process.env.RUNNINGHUB_INSTANCE_TYPE || 'plus';

function loadRegistry() {
  const raw = process.env.RUNNINGHUB_WORKFLOWS || '';
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('[runninghub] RUNNINGHUB_WORKFLOWS inválido:', err.message);
    return {};
  }
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
    description: cfg.description || ''
  }));
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('invalid_asset');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('invalid_asset_size');
  return { buffer, contentType: match[1] };
}

function makeForm(buffer, contentType, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  return form;
}

async function uploadAsset(dataUrl) {
  const { buffer, contentType } = dataUrlToBlob(dataUrl);
  const filename = `ghostlens-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;

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
    if (value) return { value, url: data.data.download_url || value, fileName: data.data.fileName || data.data.file_name || null };
  }

  // Fallback legacy: retorna fileName (para nós LoadImage)
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
    if (value) return { value, url: legacyData.data.download_url || value, fileName: legacyData.data.fileName || legacyData.data.file_name || null };
  }

  throw new Error(`runninghub_upload_failed_${res.status}`);
}

function pickAsset(assets, index) {
  return assets[index] || assets[0] || null;
}

function buildNodeInfoList(config, body, assets) {
  const list = [];
  const inputs = config.inputs || {};
  let refIndex = 0;

  for (const [key, mapping] of Object.entries(inputs)) {
    if (!mapping || !mapping.nodeId || !mapping.fieldName) continue;
    let value;

    if (mapping.source === 'prompt' || key === 'prompt') {
      value = body.prompt;
    } else if (mapping.source === 'negative_prompt' || key === 'negative_prompt') {
      value = body.negative_prompt;
    } else if (mapping.asset === 'image' || key === 'image') {
      const asset = pickAsset(assets, 0);
      value = mapping.assetValue === 'fileName'
        ? (asset && asset.fileName)
        : (asset && asset.value);
    } else if (key.startsWith('reference_')) {
      const idx = Math.max(0, Number(key.split('_')[1]) - 1);
      const asset = pickAsset(assets, idx);
      value = mapping.assetValue === 'fileName'
        ? (asset && asset.fileName)
        : (asset && asset.value);
    } else if (mapping.asset === 'lora' || key === 'lora' || key === 'lora_name') {
      value = body.lora_file || body.lora_name || config.defaultLora || '';
    } else if (key === 'lora_weight' || key === 'strength_model') {
      value = body.lora_weight !== undefined ? Number(body.lora_weight) : (config.defaultLoraWeight || 1.0);
    } else if (key === 'seed') {
      value = body.seed !== undefined ? Number(body.seed) : Math.floor(Math.random() * 1000000000);
    } else {
      value = body[key];
    }

    if (value === undefined || value === null || value === '') continue;
    if (mapping.type === 'number' || key === 'lora_weight' || key === 'seed' || key === 'width' || key === 'height') {
      value = Number(value);
    }
    list.push({ nodeId: String(mapping.nodeId), fieldName: String(mapping.fieldName), fieldValue: value });
    if (key === 'image') refIndex += 1;
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

  const references = Array.isArray(body.references) ? body.references.slice(0, Number(config.maxReferences) || 3) : [];
  if (!references.length && config.requiresReference !== false) {
    return {
      status: 400,
      payload: { error: 'reference_required', message: 'Envie ao menos uma foto de referência da musa.' }
    };
  }

  try {
    const assets = [];
    for (const ref of references) {
      assets.push(await uploadAsset(ref));
    }

    const nodeInfoList = buildNodeInfoList(config, body, assets);
    if (!nodeInfoList.length) {
      return {
        status: 400,
        payload: { error: 'workflow_inputs_not_configured', message: 'O workflow não tem mapeamento de inputs configurado.' }
      };
    }

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
        instanceType: config.instanceType || DEFAULT_INSTANCE
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
        credits: Number(config.credits) || 0,
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

function extractFirstUrl(results) {
  if (!Array.isArray(results)) return '';
  for (const item of results) {
    if (!item) continue;
    if (typeof item === 'string' && /^https?:\/\//.test(item)) return item;
    if (item.url) return item.url;
    if (item.outputUrl) return item.outputUrl;
    if (item.fileUrl) return item.fileUrl;
  }
  return '';
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
      const url = extractFirstUrl(results);
      if (!url) {
        return { status: 502, payload: { error: 'empty_result', message: 'O RunningHub não retornou imagem.', task_id: taskId } };
      }
      let imageUrl = url;
      try {
        const dl = await fetch(url);
        if (dl.ok) {
          const contentType = dl.headers.get('content-type') || 'image/jpeg';
          const buffer = Buffer.from(await dl.arrayBuffer());
          if (buffer.length <= 15 * 1024 * 1024) {
            imageUrl = await storeImage(buffer, contentType.split(';')[0]);
          }
        }
      } catch (err) {
        console.warn('[runninghub] download/storage:', err.message);
      }
      return {
        status: 200,
        payload: { status: 'success', task_id: String(taskId), image_url: imageUrl, provider_cost: providerCost }
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
