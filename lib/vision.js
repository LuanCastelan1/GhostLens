// ============================================================================
// GhostLens • Vision composition agent
//
// Recebe uma imagem de referência (Pinterest ou upload), extrai a composição
// em JSON via Vision LLM e monta o prompt final no servidor. O prompt final
// nunca é devolvido ao frontend.
//
// Env (uma das duas):
//   OPENAI_API_KEY   (VISION_PROVIDER=openai)
//   GEMINI_API_KEY   (VISION_PROVIDER=gemini)
// ============================================================================
'use strict';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const VISION_PROVIDER = String(
  process.env.VISION_PROVIDER || (OPENAI_API_KEY ? 'openai' : (GEMINI_API_KEY ? 'gemini' : ''))
).toLowerCase();
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_HOSTS = ['pinimg.com', 'pinterest.com'];

function visionError(code, message, status = 400) {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

function isAllowedImageUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_IMAGE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function parseDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(value || ''));
  if (!match) throw visionError('invalid_image', 'Imagem base64 inválida.');
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw visionError('invalid_image_size', 'A imagem precisa ter no máximo 10 MB.');
  }
  return { mimeType: match[1], base64, buffer };
}

async function fetchReferenceImage(url) {
  if (!isAllowedImageUrl(url)) {
    throw visionError('image_url_not_allowed', 'Use uma imagem do Pinterest (pinimg.com) ou envie o arquivo.');
  }

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw visionError('image_fetch_failed', 'Não foi possível baixar a imagem de referência.', 502);
  if (!isAllowedImageUrl(res.url)) {
    throw visionError('image_url_not_allowed', 'O redirecionamento da imagem não é permitido.');
  }
  const contentType = String(res.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw visionError('invalid_image', 'O link não aponta para uma imagem.');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw visionError('invalid_image_size', 'A imagem precisa ter no máximo 10 MB.');
  }
  return {
    mimeType: contentType,
    base64: buffer.toString('base64'),
    buffer
  };
}

async function resolveReferenceImage({ image_url, image_base64 }) {
  if (image_base64) return parseDataUrl(image_base64);
  if (image_url) return fetchReferenceImage(image_url);
  throw visionError('image_required', 'Envie a imagem de referência (upload ou URL do Pinterest).');
}

function buildInstruction(personaDna, personaName) {
  const dna = typeof personaDna === 'string' ? personaDna : JSON.stringify(personaDna || {});
  return [
    'You are a visual composition analyst for a photorealistic AI studio.',
    'Analyze only the scene composition of the reference image: pose, framing, camera angle/lens, lighting, background, outfit style, color palette and mood.',
    'Do not identify the person, do not describe identity, and do not copy logos or text.',
    'Return strict JSON only, with these keys: pose, framing, camera, lighting, background, outfit, color_palette, mood, composition_notes.',
    `Persona name: ${personaName || 'Musa'}.`,
    `Persona DNA (identity to preserve, not to analyze): ${dna || 'not provided'}.`
  ].join('\n');
}

async function callOpenAIVision(image, instruction) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      temperature: 0.4,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You return only valid JSON. No markdown.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }
          ]
        }
      ]
    })
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw visionError('vision_provider_error', (data && data.error && data.error.message) || 'Falha no provedor de visão.', 502);
  }
  return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

async function callGeminiVision(image, instruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_VISION_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: instruction },
          { inline_data: { mime_type: image.mimeType, data: image.base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 800,
        responseMimeType: 'application/json'
      }
    })
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw visionError('vision_provider_error', (data && data.error && data.error.message) || 'Falha no provedor de visão.', 502);
  }
  return (data && data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text) || '';
}

function parseComposition(raw) {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Alguns modelos devolvem texto antes/depois do JSON.
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // cai no fallback
      }
    }
  }
  return { composition_notes: String(raw || '').trim() };
}

function buildFinalPrompt(personaDna, composition) {
  const dna = typeof personaDna === 'string' ? personaDna : JSON.stringify(personaDna || {});
  const parts = [
    dna,
    composition.pose ? `pose: ${composition.pose}` : '',
    composition.framing ? `framing: ${composition.framing}` : '',
    composition.camera ? `camera: ${composition.camera}` : '',
    composition.lighting ? `lighting: ${composition.lighting}` : '',
    composition.background ? `background: ${composition.background}` : '',
    composition.outfit ? `outfit: ${composition.outfit}` : '',
    composition.color_palette ? `color palette: ${composition.color_palette}` : '',
    composition.mood ? `mood: ${composition.mood}` : '',
    composition.composition_notes || '',
    'photorealistic, natural skin texture, high detail, 85mm lens'
  ];
  return parts.filter(Boolean).join(', ');
}

async function analyzeComposition({ image_url, image_base64, persona_dna, persona_name }) {
  const image = await resolveReferenceImage({ image_url, image_base64 });
  const instruction = buildInstruction(persona_dna, persona_name);

  let raw = '';
  if (VISION_PROVIDER === 'openai' && OPENAI_API_KEY) {
    raw = await callOpenAIVision(image, instruction);
  } else if (VISION_PROVIDER === 'gemini' && GEMINI_API_KEY) {
    raw = await callGeminiVision(image, instruction);
  } else {
    throw visionError('vision_not_configured', 'Configure OPENAI_API_KEY ou GEMINI_API_KEY no servidor.', 503);
  }

  const composition = parseComposition(raw);
  const prompt = buildFinalPrompt(persona_dna, composition);
  return { prompt, composition };
}

module.exports = {
  analyzeComposition,
  visionConfigured: Boolean(
    (VISION_PROVIDER === 'openai' && OPENAI_API_KEY) ||
    (VISION_PROVIDER === 'gemini' && GEMINI_API_KEY)
  )
};
