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
    'photorealistic, natural skin texture, micro-pores, specular sheen, high detail, raw photo'
  ];
  return parts.filter(Boolean).join(', ');
}

// ----------------------------------------------------------------------------
// GhostDirector • Carrossel Multi-Pose por IA (Gemini / OpenAI Director)
// Gera N variações de poses complementares da mesma cena, roupa e modelo
// para montar um Carrossel do Instagram ou Pack do Privacy.
// ----------------------------------------------------------------------------
function buildDirectorFallback(sceneDescription, personaName, personaDna, shotCount) {
  const baseDna = personaDna || `${personaName || 'Musa'}, brazilian woman, voluptuous curves, natural olive skin, dark hair`;
  const desc = sceneDescription || 'lingerie sensual no quarto moderno de hotel';

  const defaultTemplates = [
    {
      shot_number: 1,
      title: 'Take 1: Corpo Inteiro (Selfie / Entrada)',
      angle: 'Full Body Standing / Mirror Selfie',
      focus: 'Apresentação do cenário e roupa de frente',
      prompt: `${baseDna}, standing naturally in front of full-length mirror, holding smartphone, front view full body, wearing ${desc}, soft ambient window light, modern bedroom aesthetic, photorealistic, raw 35mm photo, specular reflections, natural skin pores, 8k resolution`
    },
    {
      shot_number: 2,
      title: 'Take 2: Pose Provocante (Agachada / Costas)',
      angle: 'Back Arch / Squatting Over-the-shoulder Glance',
      focus: 'Sensualidade, curvas traseiras e olhar para a câmera',
      prompt: `${baseDna}, sensual squatting pose on plush carpet near bed, body turned away, arched back looking seductively over shoulder directly into camera, wearing ${desc}, defined glutes and legs, realistic dermis texture, goosebumps, natural rim lighting, sharp focus, raw photograph`
    },
    {
      shot_number: 3,
      title: 'Take 3: Espontânea Sentada (Meio-Corpo)',
      angle: 'Medium Shot / Sitting on Bed Edge',
      focus: 'Expressão natural, sorriso espontâneo e elegância',
      prompt: `${baseDna}, sitting gracefully on the edge of king size bed with white satin sheets, one leg crossed over the other, relaxed seductive smile, touching hair gently, wearing ${desc}, warm interior chandelier lighting, shallow depth of field, high-end editorial photo`
    },
    {
      shot_number: 4,
      title: 'Take 4: Close-up Íntimo (Retrato / Derme 2K)',
      angle: 'Close-Up Portrait / Lying Down',
      focus: 'Olhar penetrante, lábios, microporos e detalhe da pele',
      prompt: `${baseDna}, lying on stomach on luxury bed pillows, intimate extreme close-up portrait, intense gaze looking directly at viewer, slightly parted glossy lips, wearing ${desc}, macro skin texture with visible micro-pores, natural eye catchlights, soft cinematic lighting, 85mm lens f/1.4`
    }
  ];

  return defaultTemplates.slice(0, Math.min(shotCount, 4));
}

async function callGeminiText(prompt, systemInstruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_VISION_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `${systemInstruction}\n\nTask: ${prompt}` }]
      }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 1500,
        responseMimeType: 'application/json'
      }
    })
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw visionError('gemini_error', (data && data.error && data.error.message) || 'Falha no Gemini.', 502);
  }
  return (data && data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text) || '';
}

async function generateCarouselDirectorPrompts({
  scene_description,
  persona_name = 'Leninha',
  persona_dna = '',
  shot_count = 4,
  style = 'instagram_carousel'
}) {
  const count = Math.max(1, Math.min(Number(shot_count) || 4, 8));

  if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
    // Fallback de alta fidelidade instantâneo sem depender de chave externa
    const fallbackShots = buildDirectorFallback(scene_description, persona_name, persona_dna, count);
    return {
      director_mode: 'curated_preset',
      theme: scene_description || 'Ensaio Hot Exclusivo',
      shots: fallbackShots
    };
  }

  const systemInstruction = `You are an elite creative director and photographer for high-end digital models, Instagram creators and Privacy/OnlyFans exclusive content.
You create coherent, diverse multi-shot sessions of the EXACT SAME character, wearing the EXACT SAME outfit, in the EXACT SAME location and lighting, but from N different dynamic angles and postures.
Always return strict JSON with this structure:
{
  "theme": "Brief title of the photoshoot",
  "setting_summary": "Description of environment",
  "outfit_summary": "Description of outfit",
  "shots": [
    {
      "shot_number": 1,
      "title": "Short title (e.g. Take 1: Selfie Espelho)",
      "angle": "Camera framing and angle",
      "focus": "Key focus of this shot",
      "prompt": "Full photorealistic prompt in English ready for diffusion models with raw photography cues, micro-pores and lens specifications"
    }
  ]
}`;

  const userPrompt = `Direct a ${count}-shot carousel photoshoot.
Scene / Outfit Concept: "${scene_description || 'Sensual bedroom session in luxury hotel'}"
Model Name: "${persona_name}"
Persona DNA: "${persona_dna || 'Brazilian woman, voluptuous athletic physique, natural olive skin, dark hair'}"
Style Context: "${style}"

Create exactly ${count} distinct shots:
1. Establishing / Front / Full Body
2. Provocative / Back or Side Glance / Arched pose (e.g. squatting or looking over shoulder)
3. Relaxed / Mid-shot / Sitting or Leaning
4. Intimate Macro Close-up / Portrait emphasizing eyes, lips and skin dermis.`;

  let raw = '';
  try {
    if (GEMINI_API_KEY) {
      raw = await callGeminiText(userPrompt, systemInstruction);
    } else if (OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OPENAI_VISION_MODEL,
          temperature: 0.6,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt }
          ]
        })
      });
      const data = await res.json();
      raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    }
  } catch (err) {
    console.warn('[vision/director] LLM call failed, using high-fidelity fallback:', err.message);
  }

  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
    }
  }

  if (parsed && Array.isArray(parsed.shots) && parsed.shots.length) {
    return {
      director_mode: GEMINI_API_KEY ? 'gemini_director' : 'openai_director',
      theme: parsed.theme || scene_description,
      setting_summary: parsed.setting_summary || '',
      outfit_summary: parsed.outfit_summary || '',
      shots: parsed.shots
    };
  }

  return {
    director_mode: 'curated_preset',
    theme: scene_description || 'Ensaio Hot Exclusivo',
    shots: buildDirectorFallback(scene_description, persona_name, persona_dna, count)
  };
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
  generateCarouselDirectorPrompts,
  visionConfigured: Boolean(
    (VISION_PROVIDER === 'openai' && OPENAI_API_KEY) ||
    (VISION_PROVIDER === 'gemini' && GEMINI_API_KEY)
  )
};
