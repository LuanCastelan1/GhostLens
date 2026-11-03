/* ============================================================================
   Ghost Studio Pro • Editor de vídeo multi-trilha
   Página independente do GhostLens Studio. Não altera o editor existente.
   Render de preview/exportação no navegador + daemon local para FFmpeg.
   ========================================================================== */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://mbelyevitfksmknlyhgr.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_MePEjLaShnmXt8xwafSxew_iXNXhfi1';
  const DAEMON = 'http://127.0.0.1:4444';
  const CLOUD_API = 'https://www.ghostlens.cloud/api';
  const DB_NAME = 'ghoststudio-pro';
  const DB_VERSION = 1;
  const SAVE_DEBOUNCE = 650;

  const ASPECTS = {
    '9:16': { w: 1080, h: 1920, label: '9:16' },
    '16:9': { w: 1920, h: 1080, label: '16:9' },
    '1:1': { w: 1080, h: 1080, label: '1:1' },
    '4:5': { w: 1080, h: 1350, label: '4:5' }
  };

  const EFFECTS = [
    { id: 'none', name: 'Original', cat: 'basic', filter: '' },
    { id: 'musa_glow', name: 'Musa Glow', cat: 'beauty', filter: 'brightness(1.06) contrast(1.05) saturate(1.16)' },
    { id: 'peachy_skin', name: 'Pele Pêssego', cat: 'beauty', filter: 'brightness(1.04) contrast(1.03) saturate(1.12) sepia(0.08)' },
    { id: 'korean_porcelain', name: 'Porcelana', cat: 'beauty', filter: 'brightness(1.08) contrast(0.98) saturate(0.95)' },
    { id: 'summer_bronze', name: 'Bronze Verão', cat: 'beauty', filter: 'brightness(1.03) contrast(1.08) saturate(1.22) sepia(0.12)' },
    { id: 'ring_light', name: 'Ring Light', cat: 'beauty', filter: 'brightness(1.1) contrast(1.05) saturate(1.05)' },
    { id: 'soft_glamour', name: 'Soft Glamour', cat: 'beauty', filter: 'brightness(1.04) contrast(1.02) saturate(1.08) blur(0.2px)' },
    { id: 'cinema_teal', name: 'Teal & Orange', cat: 'cinema', filter: 'contrast(1.12) saturate(1.25) hue-rotate(-6deg)' },
    { id: 'vintage_90s', name: 'Vintage 90s', cat: 'cinema', filter: 'sepia(0.32) contrast(1.05) saturate(0.9)' },
    { id: 'noir_bw', name: 'Noir P&B', cat: 'cinema', filter: 'grayscale(1) contrast(1.35) brightness(0.96)' },
    { id: 'kodak_portra', name: 'Kodak Portra', cat: 'cinema', filter: 'sepia(0.14) contrast(1.06) saturate(1.1)' },
    { id: 'fuji_velvia', name: 'Fuji Velvia', cat: 'cinema', filter: 'contrast(1.18) saturate(1.3) hue-rotate(3deg)' },
    { id: 'moody_wood', name: 'Moody Wood', cat: 'cinema', filter: 'contrast(1.12) saturate(0.82) brightness(0.97)' },
    { id: 'flash_vip', name: 'Flash VIP', cat: 'viral', filter: 'contrast(1.2) brightness(1.08) saturate(1.15)' },
    { id: 'vivid_pop', name: 'Vivid Pop', cat: 'viral', filter: 'contrast(1.14) saturate(1.75)' },
    { id: 'cyber_neon', name: 'Cyber Neon', cat: 'viral', filter: 'contrast(1.18) saturate(1.9) hue-rotate(12deg)' },
    { id: 'sunset_hour', name: 'Sunset Hour', cat: 'viral', filter: 'brightness(1.05) contrast(1.06) saturate(1.35) sepia(0.15)' },
    { id: 'vaporwave', name: 'Vaporwave', cat: 'viral', filter: 'hue-rotate(140deg) contrast(1.1) saturate(1.5)' },
    { id: 'glitch_shimmer', name: 'Glitch Shimmer', cat: 'viral', filter: 'contrast(1.2) saturate(1.25) hue-rotate(-8deg)' },
    { id: 'soft_dream', name: 'Soft Dream', cat: 'atmosphere', filter: 'blur(1.1px) brightness(1.06) contrast(1.06) saturate(1.1)' },
    { id: 'candlelight', name: 'Candlelight', cat: 'atmosphere', filter: 'sepia(0.2) brightness(1.05) contrast(1.1) saturate(1.3)' },
    { id: 'nordic_blue', name: 'Nordic Blue', cat: 'atmosphere', filter: 'hue-rotate(12deg) contrast(1.08) saturate(0.88) brightness(1.02)' },
    { id: 'grain_16mm', name: 'Grain 16mm', cat: 'atmosphere', filter: 'contrast(1.15) brightness(0.97) saturate(0.92)' },
    { id: 'anamorphic_flare', name: 'Anamorphic', cat: 'atmosphere', filter: 'contrast(1.18) brightness(1.05) saturate(1.16)' },
    { id: 'nightclub_pulse', name: 'Nightclub', cat: 'atmosphere', filter: 'contrast(1.3) saturate(1.6) hue-rotate(8deg)' }
  ];

  const EFFECT_CATS = [
    { id: 'all', name: 'Todos' },
    { id: 'beauty', name: 'Beleza' },
    { id: 'cinema', name: 'Cinema' },
    { id: 'viral', name: 'Viral' },
    { id: 'atmosphere', name: 'Atmosfera' }
  ];

  const TRANSITIONS = [
    { id: 'none', name: 'Sem transição', glyph: '—' },
    { id: 'fade', name: 'Fade', glyph: '◐' },
    { id: 'fadeblack', name: 'Fade preto', glyph: '●' },
    { id: 'fadewhite', name: 'Fade branco', glyph: '○' },
    { id: 'slideleft', name: 'Deslizar ←', glyph: '⇠' },
    { id: 'slideright', name: 'Deslizar →', glyph: '⇢' },
    { id: 'slideup', name: 'Deslizar ↑', glyph: '⇡' },
    { id: 'slidedown', name: 'Deslizar ↓', glyph: '⇣' },
    { id: 'zoomin', name: 'Zoom in', glyph: '⊕' },
    { id: 'zoomout', name: 'Zoom out', glyph: '⊖' },
    { id: 'spin', name: 'Girar', glyph: '↻' },
    { id: 'blur', name: 'Blur', glyph: '◌' },
    { id: 'glitch', name: 'Glitch', glyph: '⚡' },
    { id: 'flash', name: 'Flash', glyph: '✶' },
    { id: 'wipeleft', name: 'Wipe ←', glyph: '◧' },
    { id: 'wiperight', name: 'Wipe →', glyph: '◨' }
  ];

  const TEXT_TEMPLATES = [
    {
      name: 'Título viral', desc: 'Grande, branco e centralizado',
      props: { text: 'SEU TÍTULO', size: 92, weight: '900', color: '#ffffff', animation: 'pop', y: 50 }
    },
    {
      name: 'Legenda limpa', desc: 'Fundo escuro e leitura fácil',
      props: { text: 'Sua legenda aqui', size: 46, weight: '700', color: '#ffffff', bg: '#000000', bgOpacity: 0.58, animation: 'fade', y: 82 }
    },
    {
      name: 'Chamada neon', desc: 'Verde GhostLens com brilho',
      props: { text: 'NOVO', size: 74, weight: '900', color: '#bef264', stroke: '#0a0d12', strokeWidth: 8, animation: 'slideup', y: 22 }
    },
    {
      name: 'Lower third', desc: 'Nome e função no canto',
      props: { text: 'NOME\n@seuperfil', size: 42, weight: '700', color: '#ffffff', bg: '#0b1220', bgOpacity: 0.72, align: 'left', x: 8, y: 82, animation: 'slideup' }
    }
  ];

  const VOICES = [
    { id: 'Vivian', name: 'Vivian • feminina suave' },
    { id: 'Serena', name: 'Serena • feminina madura' },
    { id: 'Ono_Anna', name: 'Ono Anna • feminina jovem' },
    { id: 'Sohee', name: 'Sohee • feminina delicada' },
    { id: 'Uncle_Fu', name: 'Uncle Fu • masculina grave' },
    { id: 'Dylan', name: 'Dylan • masculina jovem' },
    { id: 'Eric', name: 'Eric • masculina natural' },
    { id: 'Ryan', name: 'Ryan • masculina energética' },
    { id: 'Aiden', name: 'Aiden • masculina calma' }
  ];

  const VOICE_STYLES = [
    { id: 'natural', name: 'Natural e clara', instruction: 'Fale de forma natural, clara e próxima.' },
    { id: 'narration', name: 'Narração cinematográfica', instruction: 'Narre com presença, ritmo pausado e emoção contida.' },
    { id: 'sensual', name: 'Sensual suave', instruction: 'Fale baixo, suave e envolvente, com ritmo lento.' },
    { id: 'energetic', name: 'Energética', instruction: 'Fale com energia, entusiasmo e ritmo rápido.' },
    { id: 'whisper', name: 'Sussurro', instruction: 'Sussurre de forma intimista, muito próxima ao microfone.' },
    { id: 'documentary', name: 'Documentário', instruction: 'Fale como narrador de documentário: calmo, autoritário e claro.' },
    { id: 'young', name: 'Jovem', instruction: 'Fale com juventude, leveza e informalidade.' },
    { id: 'mature', name: 'Madura', instruction: 'Fale com maturidade, confiança e calor humano.' }
  ];

  const VOICE_FX = [
    { id: 'sensual_whisper', name: 'Sussurro sensual' },
    { id: 'asmr_breath', name: 'ASMR / respiração' },
    { id: 'deep_intimate', name: 'Grave e íntimo' },
    { id: 'sensual_moan_reverb', name: 'Reverb sensual' },
    { id: 'femme_pitch', name: 'Pitch feminino' },
    { id: 'young_girl', name: 'Voz jovem' },
    { id: 'mature_woman', name: 'Voz madura' },
    { id: 'chipmunk_fun', name: 'Chipmunk' },
    { id: 'studio_crystal', name: 'Estúdio cristal' },
    { id: 'podcast_master', name: 'Podcast master' },
    { id: 'radio_fm', name: 'Rádio FM' },
    { id: 'phone_call', name: 'Telefone' },
    { id: 'bathroom_echo', name: 'Banheiro / eco' },
    { id: 'bedroom_acoustic', name: 'Quarto acústico' },
    { id: 'club_night', name: 'Club night' },
    { id: 'cathedral_reverb', name: 'Catedral' }
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  let uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
  }

  function formatTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
  }

  function formatShort(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = Math.floor(s - m * 60);
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function slug(value) {
    return String(value || 'ghost-video')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'ghost-video';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseNumber(value, fallback = 0) {
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  }

  function mediaKind(media) {
    if (!media) return 'video';
    if (media.type === 'audio') return 'audio';
    if (media.type === 'image') return 'image';
    return 'video';
  }

  const state = {
    project: null,
    media: new Map(),
    selected: null,
    playhead: 0,
    duration: 0,
    playing: false,
    playStartWall: 0,
    zoom: 60,
    snap: true,
    masterVolume: 1,
    history: [],
    future: [],
    activeEffectCat: 'all',
    activePanel: 'media',
    daemonOnline: false,
    daemonCheckedAt: 0,
    previewCtx: null,
    mediaElements: new Map(),
    mediaNodes: new WeakMap(),
    thumbs: new Map(),
    audioCtx: null,
    monitorGain: null,
    recordDest: null,
    recorder: null,
    recordStream: null,
    exporting: false,
    exportCancel: false,
    exportAborted: false,
    exportStart: 0,
    exportDuration: 0,
    exportChunks: [],
    exportMime: '',
    exportUrl: '',
    editSnapshot: null,
    dirty: false,
    scrub: false,
    drag: null,
    supabase: null,
    user: null,
    ttsBusy: false,
    saveTimer: null,
    toastTimer: null
  };

  const els = {};

  /* ─────────────────────────── INIT ─────────────────────────── */

  function cacheEls() {
    const ids = [
      'projectName', 'btnUndo', 'btnRedo', 'serverPill', 'serverDot', 'serverLabel', 'localBanner',
      'btnAccount', 'accountBox', 'btnSave', 'btnExport', 'btnImportMedia', 'mediaInput',
      'dropzone', 'mediaList', 'effectCategories', 'effectGrid', 'transitionGrid',
      'textTemplates', 'btnAddText', 'btnImportAudio', 'audioInput', 'audioList',
      'btnRecordVoice', 'ttsText', 'ttsCount', 'ttsCost', 'ttsVoice', 'ttsLanguage',
      'ttsStyle', 'btnGenerateTTS', 'ttsLoginNote', 'voiceFxSelect', 'btnApplyVoiceFx',
      'previewShell', 'previewFrame', 'previewCanvas', 'previewEmpty', 'aspectGroup',
      'resolutionLabel', 'fpsLabel', 'btnPlay', 'currentTime', 'totalTime',
      'masterVolume', 'btnFullscreen', 'inspectorEmpty', 'inspectorBody', 'btnSplit',
      'btnDelete', 'btnDuplicate', 'btnZoomOut', 'timelineZoom', 'btnZoomIn', 'btnSnap',
      'trackLabels', 'timelineScroll', 'timelineContent', 'ruler', 'tracks', 'playhead',
      'toastWrap', 'loginModal', 'loginForm', 'loginEmail', 'loginPassword', 'loginError',
      'btnLoginSubmit', 'exportModal', 'exportSettings', 'exportResolution', 'exportFps',
      'exportFormat', 'exportSummary', 'btnStartExport', 'exportProgress', 'exportStatus',
      'exportPercent', 'exportFill', 'exportMeta', 'btnCancelExport', 'exportDone',
      'exportDoneMeta', 'btnDownloadExport', 'btnExportAgain'
    ];
    for (const id of ids) els[id] = document.getElementById(id);
    els.previewCtx = els.previewCanvas.getContext('2d', { alpha: false });
    els.previewCtx.imageSmoothingEnabled = true;
    els.previewCtx.imageSmoothingQuality = 'high';
    state.previewCtx = els.previewCtx;
  }

  async function init() {
    cacheEls();
    state.project = (await loadProjectFromDB()) || defaultProject();
    normalizeProject();
    buildStaticPanels();
    bindGlobalEvents();
    bindPanelEvents();
    bindTimelineEvents();
    bindInspectorEvents();
    bindExportEvents();
    bindLoginEvents();
    bindKeyboard();
    initSupabase();
    state.zoom = Number(els.timelineZoom.value) || 60;
    renderAll();
    checkDaemon();
    setInterval(checkDaemon, 30000);
    // Repinta o preview parado para quando a mídia terminar de carregar/ser decodificada.
    setInterval(() => {
      if (!state.playing && !state.exporting) renderPreview();
    }, 250);
    updateTTSMeta();
    updateAuthUI();
    restoreAuth();
    window.addEventListener('beforeunload', () => {
      if (state.dirty) saveProjectToDB().catch(() => {});
    });
    if (new URLSearchParams(location.search).has('debug')) {
      window.__ghostEditorState = state;
      window.__ghostEditorCompose = composeFrame;
      window.__ghostEditorRender = renderPreview;
    }
  }

  function defaultProject() {
    return {
      version: 1,
      name: 'Meu projeto',
      aspect: '9:16',
      fps: 30,
      background: '#000000',
      tracks: [
        { id: 'video', name: 'Vídeo', type: 'video', clips: [] },
        { id: 'overlay', name: 'Sobreposição', type: 'overlay', clips: [] },
        { id: 'audio', name: 'Música', type: 'audio', clips: [] },
        { id: 'voice', name: 'Voz', type: 'audio', clips: [] }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function normalizeProject() {
    if (!state.project || typeof state.project !== 'object') state.project = defaultProject();
    state.project.version = 1;
    state.project.name = String(state.project.name || 'Meu projeto');
    if (!ASPECTS[state.project.aspect]) state.project.aspect = '9:16';
    state.project.fps = [24, 30, 60].includes(Number(state.project.fps)) ? Number(state.project.fps) : 30;
    state.project.background = state.project.background || '#000000';
    const defaults = defaultProject().tracks;
    if (!Array.isArray(state.project.tracks) || state.project.tracks.length === 0) {
      state.project.tracks = defaults;
    } else {
      for (const def of defaults) {
        let track = state.project.tracks.find((t) => t.id === def.id);
        if (!track) {
          track = { ...def, clips: [] };
          state.project.tracks.push(track);
        }
        track.name = track.name || def.name;
        track.type = def.type;
        if (!Array.isArray(track.clips)) track.clips = [];
        for (const clip of track.clips) normalizeClip(clip, track.id);
      }
    }
    state.project.tracks.sort((a, b) => {
      const order = { video: 0, overlay: 1, audio: 2, voice: 3 };
      return (order[a.id] ?? 9) - (order[b.id] ?? 9);
    });
    recalcDuration();
  }

  function normalizeClip(clip, trackId) {
    clip.id = clip.id || uid('clip');
    clip.mediaId = clip.mediaId || null;
    clip.name = clip.name || 'Clipe';
    clip.start = Math.max(0, Number(clip.start) || 0);
    clip.in = Math.max(0, Number(clip.in) || 0);
    clip.out = Math.max(clip.in + 0.05, Number(clip.out) || clip.in + 5);
    clip.speed = clamp(clip.speed || 1, 0.25, 4);
    clip.duration = Math.max(0.08, Number(clip.duration) || (clip.out - clip.in) / clip.speed || 1);
    clip.volume = clamp(clip.volume ?? 1, 0, 2);
    clip.effect = clip.effect || 'none';
    clip.effectIntensity = clamp(clip.effectIntensity ?? 100, 0, 100);
    clip.transition = clip.transition || { type: 'none', duration: 0.5 };
    clip.transition.duration = clamp(clip.transition.duration || 0.5, 0.1, 2);
    clip.transform = clip.transform || { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
    clip.fadeIn = clamp(clip.fadeIn || 0, 0, 10);
    clip.fadeOut = clamp(clip.fadeOut || 0, 0, 10);
    if (trackId === 'overlay' && (clip.text != null || !clip.mediaId)) {
      clip.text = clip.text ?? 'Seu texto';
      clip.font = clip.font || 'Inter';
      clip.size = clamp(clip.size || 64, 8, 300);
      clip.weight = String(clip.weight || '800');
      clip.color = clip.color || '#ffffff';
      clip.bg = clip.bg || '#000000';
      clip.bgOpacity = clamp(clip.bgOpacity ?? 0, 0, 1);
      clip.stroke = clip.stroke || '#000000';
      clip.strokeWidth = clamp(clip.strokeWidth || 0, 0, 30);
      clip.align = clip.align || 'center';
      clip.x = clamp(clip.x ?? 50, 0, 100);
      clip.y = clamp(clip.y ?? 50, 0, 100);
      clip.animation = clip.animation || 'fade';
    }
    if (trackId === 'video' || trackId === 'overlay') {
      if (clip.mediaId) {
        clip.kind = clip.kind || (clip.text != null && !clip.mediaId ? 'text' : 'media');
      }
    }
    if (trackId === 'audio' || trackId === 'voice') clip.kind = 'audio';
    return clip;
  }

  /* ─────────────────────────── PANELS ─────────────────────────── */

  function buildStaticPanels() {
    els.effectCategories.innerHTML = EFFECT_CATS.map((cat) => (
      `<button class="chip${cat.id === 'all' ? ' active' : ''}" data-effect-cat="${cat.id}">${cat.name}</button>`
    )).join('');

    els.effectGrid.innerHTML = EFFECTS.map((fx) => (
      `<button class="effect-card" data-effect="${fx.id}" title="${escapeHtml(fx.name)}">
        <div class="effect-preview" style="--fx:${fx.filter || 'none'}"></div>
        <div class="effect-name">${escapeHtml(fx.name)}</div>
      </button>`
    )).join('');

    els.transitionGrid.innerHTML = TRANSITIONS.map((tr) => (
      `<button class="transition-card" data-transition="${tr.id}">
        <span class="transition-glyph">${tr.glyph}</span>
        <span class="transition-name">${escapeHtml(tr.name)}</span>
      </button>`
    )).join('');

    els.textTemplates.innerHTML = TEXT_TEMPLATES.map((tpl, idx) => (
      `<button class="template-card" data-template="${idx}">
        <div class="template-preview">${escapeHtml(tpl.name)}</div>
        <strong>${escapeHtml(tpl.name)}</strong>
        <span>${escapeHtml(tpl.desc)}</span>
      </button>`
    )).join('');

    els.ttsVoice.innerHTML = VOICES.map((v) => (
      `<option value="${v.id}">${escapeHtml(v.name)}</option>`
    )).join('');

    els.ttsStyle.innerHTML = VOICE_STYLES.map((s) => (
      `<option value="${s.id}">${escapeHtml(s.name)}</option>`
    )).join('');

    els.voiceFxSelect.innerHTML = VOICE_FX.map((fx) => (
      `<option value="${fx.id}">${escapeHtml(fx.name)}</option>`
    )).join('');

    renderAspectButtons();
  }

  function renderAspectButtons() {
    $$('#aspectGroup button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.aspect === state.project.aspect);
    });
    const dims = ASPECTS[state.project.aspect];
    els.resolutionLabel.textContent = `${dims.w} × ${dims.h}`;
    els.fpsLabel.textContent = `${state.project.fps} fps`;
    els.previewFrame.style.aspectRatio = `${dims.w} / ${dims.h}`;
    if (els.previewCanvas.width !== dims.w || els.previewCanvas.height !== dims.h) {
      els.previewCanvas.width = dims.w;
      els.previewCanvas.height = dims.h;
    }
  }

  function showPanel(name) {
    state.activePanel = name;
    $$('.panel-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    $$('.panel-view').forEach((view) => view.classList.toggle('active', view.id === `view${name[0].toUpperCase()}${name.slice(1)}`));
  }

  /* ─────────────────────────── EVENTS ─────────────────────────── */

  function bindGlobalEvents() {
    els.projectName.addEventListener('input', () => {
      state.project.name = els.projectName.value;
      state.dirty = true;
      scheduleSave();
    });
    els.projectName.addEventListener('blur', () => {
      if (!els.projectName.value.trim()) {
        els.projectName.value = 'Meu projeto';
        state.project.name = els.projectName.value;
      }
      scheduleSave();
    });

    els.btnUndo.addEventListener('click', undo);
    els.btnRedo.addEventListener('click', redo);
    els.btnSave.addEventListener('click', () => saveProjectNow(true));
    els.btnExport.addEventListener('click', openExportModal);

    $$('#aspectGroup button').forEach((btn) => {
      btn.addEventListener('click', () => setAspect(btn.dataset.aspect));
    });

    els.btnPlay.addEventListener('click', togglePlay);
    els.masterVolume.addEventListener('input', () => {
      state.masterVolume = clamp(els.masterVolume.value, 0, 100) / 100;
      if (state.monitorGain) state.monitorGain.gain.value = state.masterVolume;
      if (state.playing) syncMedia(state.playhead, true);
    });
    els.btnFullscreen.addEventListener('click', toggleFullscreen);

    els.mediaInput.addEventListener('change', (e) => {
      importFiles(Array.from(e.target.files || []));
      e.target.value = '';
    });
    els.audioInput.addEventListener('change', (e) => {
      importFiles(Array.from(e.target.files || []), { autoAdd: 'audio' });
      e.target.value = '';
    });
    els.btnImportMedia.addEventListener('click', () => els.mediaInput.click());
    els.btnImportAudio.addEventListener('click', () => els.audioInput.click());

    els.dropzone.addEventListener('click', () => els.mediaInput.click());
    els.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.dropzone.classList.add('dragover');
    });
    els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
    els.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropzone.classList.remove('dragover');
      importFiles(Array.from(e.dataTransfer?.files || []));
    });

    els.timelineZoom.addEventListener('input', () => setZoom(Number(els.timelineZoom.value)));
    els.btnZoomIn.addEventListener('click', () => setZoom(state.zoom + 20));
    els.btnZoomOut.addEventListener('click', () => setZoom(state.zoom - 20));
    els.btnSnap.addEventListener('click', () => {
      state.snap = !state.snap;
      els.btnSnap.setAttribute('aria-pressed', String(state.snap));
    });

    els.btnSplit.addEventListener('click', splitSelected);
    els.btnDelete.addEventListener('click', deleteSelected);
    els.btnDuplicate.addEventListener('click', duplicateSelected);

    els.btnAddText.addEventListener('click', () => addTextClip({}));
    els.btnGenerateTTS.addEventListener('click', generateTTS);
    els.ttsText.addEventListener('input', updateTTSMeta);

    els.btnApplyVoiceFx.addEventListener('click', applyVoiceFx);
    els.btnRecordVoice.addEventListener('click', toggleRecordVoice);

    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-close]')) {
        const modal = document.getElementById(e.target.closest('[data-close]').dataset.close);
        if (modal) modal.hidden = true;
      }
    });

    $$('.modal-backdrop').forEach((modal) => {
      modal.addEventListener('pointerdown', (e) => {
        if (e.target === modal) modal.hidden = true;
      });
    });

    els.accountBox.addEventListener('click', (e) => {
      if (e.target.closest('#btnAccount')) {
        if (state.user) {
          if (confirm(`Sair da conta ${state.user.email}?`)) logout();
        } else {
          openLogin();
        }
      }
    });

    // Atualiza as opções de voz FX quando um clipe de áudio é selecionado.
    els.voiceFxSelect.addEventListener('change', () => {});
  }

  function bindPanelEvents() {
    $$('.panel-tab').forEach((tab) => {
      tab.addEventListener('click', () => showPanel(tab.dataset.tab));
    });

    els.effectCategories.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-effect-cat]');
      if (!chip) return;
      state.activeEffectCat = chip.dataset.effectCat;
      $$('.chip', els.effectCategories).forEach((c) => c.classList.toggle('active', c === chip));
      $$('.effect-card', els.effectGrid).forEach((card) => {
        const fx = EFFECTS.find((f) => f.id === card.dataset.effect);
        card.hidden = state.activeEffectCat !== 'all' && fx?.cat !== state.activeEffectCat;
      });
    });

    els.effectGrid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-effect]');
      if (card) applyEffect(card.dataset.effect);
    });

    els.transitionGrid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-transition]');
      if (card) applyTransition(card.dataset.transition);
    });

    els.textTemplates.addEventListener('click', (e) => {
      const card = e.target.closest('[data-template]');
      if (!card) return;
      const tpl = TEXT_TEMPLATES[Number(card.dataset.template)];
      if (tpl) addTextClip(tpl.props);
    });
  }

  function bindTimelineEvents() {
    els.ruler.addEventListener('pointerdown', (e) => {
      state.scrub = true;
      els.ruler.setPointerCapture(e.pointerId);
      seekFromPointer(e);
    });
    els.ruler.addEventListener('pointermove', (e) => {
      if (state.scrub) seekFromPointer(e);
    });
    els.ruler.addEventListener('pointerup', () => { state.scrub = false; });
    els.ruler.addEventListener('pointercancel', () => { state.scrub = false; });

    els.tracks.addEventListener('pointerdown', (e) => {
      const clipEl = e.target.closest('.clip');
      if (!clipEl) return;
      const trackId = clipEl.dataset.track;
      const clipId = clipEl.dataset.clip;
      selectClip(trackId, clipId);
      const clip = findClip(trackId, clipId);
      if (!clip) return;
      e.preventDefault();
      const handle = e.target.closest('.trim-handle');
      if (handle) startTrim(e, clipEl, clip, handle.classList.contains('left'));
      else startMove(e, clipEl, clip);
    });

    els.tracks.addEventListener('dblclick', (e) => {
      const clipEl = e.target.closest('.clip');
      if (!clipEl) return;
      const clip = findClip(clipEl.dataset.track, clipEl.dataset.clip);
      if (clip?.text != null) {
        selectClip(clipEl.dataset.track, clipEl.dataset.clip);
        showPanel('text');
        setTimeout(() => $('#inspText', els.inspectorBody)?.focus(), 50);
      }
    });
  }

  function bindInspectorEvents() {
    els.inspectorBody.addEventListener('focusin', (e) => {
      if (e.target.matches('input, textarea, select')) beginEdit();
    });
    els.inspectorBody.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.dataset.prop) return;
      updateSelectedProp(el.dataset.prop, el.type === 'checkbox' ? el.checked : el.value, false);
    });
    els.inspectorBody.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset.prop) return;
      updateSelectedProp(el.dataset.prop, el.type === 'checkbox' ? el.checked : el.value, true);
      endEdit();
    });
    els.inspectorBody.addEventListener('focusout', (e) => {
      if (e.target.matches('input, textarea, select')) endEdit();
    });
    els.inspectorBody.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const act = action.dataset.action;
      if (act === 'duplicate') duplicateSelected();
      if (act === 'delete') deleteSelected();
      if (act === 'applyTransition') showPanel('transitions');
      if (act === 'applyEffect') showPanel('effects');
    });
  }

  function bindExportEvents() {
    els.btnStartExport.addEventListener('click', startExport);
    els.btnCancelExport.addEventListener('click', cancelExport);
    els.btnExportAgain.addEventListener('click', resetExportModal);
    els.exportResolution.addEventListener('change', updateExportSummary);
    els.exportFps.addEventListener('change', updateExportSummary);
    els.exportFormat.addEventListener('change', updateExportSummary);
    els.exportDone.querySelector('#btnDownloadExport')?.addEventListener('click', () => {});
  }

  function bindLoginEvents() {
    els.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.supabase) {
        els.loginError.textContent = 'SDK do Supabase não carregou. Verifique sua conexão.';
        return;
      }
      els.btnLoginSubmit.disabled = true;
      els.btnLoginSubmit.textContent = 'Entrando…';
      els.loginError.textContent = '';
      try {
        const { data, error } = await state.supabase.auth.signInWithPassword({
          email: els.loginEmail.value.trim(),
          password: els.loginPassword.value
        });
        if (error) throw error;
        state.user = data.user;
        els.loginModal.hidden = true;
        els.loginPassword.value = '';
        updateAuthUI();
        toast('Login realizado. Vozes IA liberadas.', 'success');
      } catch (err) {
        els.loginError.textContent = err.message || 'Falha no login.';
      } finally {
        els.btnLoginSubmit.disabled = false;
        els.btnLoginSubmit.textContent = 'Entrar';
      }
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if (e.key === 'Escape') {
        $$('.modal-backdrop').forEach((m) => { m.hidden = true; });
        if (!typing) selectClip(null, null);
        return;
      }
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectNow(true);
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        splitSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = (e.shiftKey ? 1 : 1 / state.project.fps) * (e.key === 'ArrowLeft' ? -1 : 1);
        seekPlayhead(state.playhead + delta);
      }
    });
  }

  /* ─────────────────────────── PROJECT / MEDIA ─────────────────────────── */

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(store, value, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadProjectFromDB() {
    try {
      const saved = await idbGet('kv', 'project');
      if (!saved) return null;
      const db = await openDB();
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction('media', 'readonly');
        const req = tx.objectStore('media').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      for (const rec of records) {
        if (!rec || !rec.blob) continue;
        const url = URL.createObjectURL(rec.blob);
        state.media.set(rec.id, {
          id: rec.id,
          name: rec.name || 'mídia',
          type: rec.type || 'video',
          blob: rec.blob,
          url,
          duration: Number(rec.duration) || 0,
          width: Number(rec.width) || 0,
          height: Number(rec.height) || 0
        });
      }
      if (saved.name) {
        // O input já existe após cacheEls; init chama isto depois.
        els.projectName.value = saved.name;
      }
      return saved;
    } catch (err) {
      console.warn('[editor] falha ao carregar projeto:', err);
      return null;
    }
  }

  function scheduleSave() {
    state.dirty = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveProjectToDB().catch(() => {}), SAVE_DEBOUNCE);
  }

  async function saveProjectToDB() {
    try {
      const project = JSON.parse(JSON.stringify(state.project));
      await idbPut('kv', project, 'project');
      state.dirty = false;
    } catch (err) {
      console.warn('[editor] falha ao salvar projeto:', err);
      toast('Não foi possível salvar automaticamente. O projeto continua aberto.', 'error');
    }
  }

  async function saveProjectNow(showToast = false) {
    clearTimeout(state.saveTimer);
    await saveProjectToDB();
    if (showToast) toast('Projeto salvo neste computador.', 'success');
  }

  async function persistMedia(media) {
    try {
      await idbPut('media', {
        id: media.id,
        name: media.name,
        type: media.type,
        blob: media.blob,
        duration: media.duration,
        width: media.width,
        height: media.height
      }, media.id);
    } catch (err) {
      console.warn('[editor] falha ao salvar mídia:', err);
      toast('Arquivo grande: não foi possível salvar a mídia no navegador. Ela continua disponível nesta sessão.', 'error');
    }
  }

  function importFiles(files, options = {}) {
    if (!files.length) return;
    const valid = files.filter((file) => (
      /^video\//.test(file.type) || /^audio\//.test(file.type) || /^image\//.test(file.type)
    ));
    if (!valid.length) {
      toast('Formato não suportado. Use vídeo, áudio ou imagem.', 'error');
      return;
    }
    (async () => {
      for (const file of valid) {
        try {
          const media = await addMediaFromBlob(file, file.name, file.type.split('/')[0], options.autoAdd);
          if (media && options.autoAdd === 'audio') addMediaToTimeline(media.id, 'audio');
        } catch (err) {
          console.error(err);
          toast(`Falha ao importar ${file.name}.`, 'error');
        }
      }
      renderMediaList();
      renderAudioList();
      renderPreviewEmpty();
      scheduleSave();
    })();
  }

  async function addMediaFromBlob(blob, name, type, autoAdd) {
    const mediaType = type === 'audio' ? 'audio' : (type === 'image' ? 'image' : 'video');
    const id = uid('media');
    const url = URL.createObjectURL(blob);
    const meta = await probeMedia(url, mediaType);
    const media = {
      id,
      name: name || `${mediaType}-${id}`,
      type: mediaType,
      blob,
      url,
      duration: meta.duration,
      width: meta.width,
      height: meta.height
    };
    state.media.set(id, media);
    await persistMedia(media);
    makeThumb(media).then((thumb) => {
      if (thumb) {
        state.thumbs.set(id, thumb);
        renderMediaList();
        renderTimeline();
      }
    });
    renderMediaList();
    renderAudioList();
    if (autoAdd && autoAdd !== 'audio') {
      // autoAdd pode ser 'video' ou 'overlay'
      addMediaToTimeline(id, autoAdd);
    }
    return media;
  }

  function probeMedia(url, type) {
    return new Promise((resolve) => {
      if (type === 'image') {
        const img = new Image();
        const done = () => resolve({ duration: 5, width: img.naturalWidth || 1080, height: img.naturalHeight || 1920 });
        img.onload = done;
        img.onerror = () => resolve({ duration: 5, width: 1080, height: 1920 });
        img.src = url;
        setTimeout(done, 4000);
        return;
      }
      const el = document.createElement(type === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata';
      el.src = url;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (type === 'audio' ? 10 : 5);
        resolve({
          duration: dur,
          width: el.videoWidth || 0,
          height: el.videoHeight || 0
        });
        el.removeAttribute('src');
        el.load();
      };
      el.addEventListener('loadedmetadata', finish, { once: true });
      el.addEventListener('error', finish, { once: true });
      setTimeout(finish, 4000);
    });
  }

  async function makeThumb(media) {
    try {
      if (media.type === 'image') return media.url;
      if (media.type === 'audio') return null;
      const v = document.createElement('video');
      v.src = media.url;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      await new Promise((resolve) => {
        const done = () => resolve();
        v.addEventListener('loadeddata', done, { once: true });
        v.addEventListener('error', done, { once: true });
        setTimeout(done, 2500);
      });
      const at = Math.min(0.2, Math.max(0, (Number.isFinite(v.duration) ? v.duration : 1) / 3));
      if (at > 0) {
        v.currentTime = at;
        await new Promise((resolve) => {
          v.addEventListener('seeked', resolve, { once: true });
          setTimeout(resolve, 900);
        });
      }
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 108;
      const ctx = canvas.getContext('2d');
      const vw = v.videoWidth || 16;
      const vh = v.videoHeight || 9;
      const scale = Math.max(canvas.width / vw, canvas.height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(v, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  function renderMediaList() {
    const all = Array.from(state.media.values());
    if (!all.length) {
      els.mediaList.innerHTML = '<div class="empty-list">Nenhuma mídia ainda.<br>Importe vídeos, fotos ou áudios para começar.</div>';
      return;
    }
    els.mediaList.innerHTML = all.map((media) => {
      const thumb = state.thumbs.get(media.id);
      const isAudio = media.type === 'audio';
      const kindLabel = isAudio ? 'AUDIO' : (media.type === 'image' ? 'FOTO' : 'VÍDEO');
      const duration = isAudio ? formatShort(media.duration) : `${formatShort(media.duration)} • ${media.width || '?'}×${media.height || '?'}`;
      return `<div class="media-item" data-media-id="${media.id}">
        <div class="media-thumb">${thumb ? `<img src="${thumb}" alt="">` : (isAudio ? '🎵' : '🎬')}</div>
        <div class="media-copy">
          <div class="media-name" title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</div>
          <div class="media-meta">${kindLabel} • ${escapeHtml(duration)}</div>
        </div>
        <div class="media-actions">
          ${isAudio
            ? `<button class="add-chip" data-add="${media.id}" data-target="audio">+ Música</button>
               <button class="add-chip blue" data-add="${media.id}" data-target="voice">+ Voz</button>`
            : `<button class="add-chip" data-add="${media.id}" data-target="video">+ Timeline</button>
               <button class="add-chip blue" data-add="${media.id}" data-target="overlay">+ PIP</button>`}
        </div>
      </div>`;
    }).join('');

    els.mediaList.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addMediaToTimeline(btn.dataset.add, btn.dataset.target);
      });
    });
  }

  function renderAudioList() {
    const audios = Array.from(state.media.values()).filter((m) => m.type === 'audio');
    if (!audios.length) {
      els.audioList.innerHTML = '<div class="empty-list">Nenhum áudio importado.<br>Importe uma música ou grave sua voz.</div>';
      return;
    }
    els.audioList.innerHTML = audios.map((media) => (
      `<div class="media-item" data-media-id="${media.id}">
        <div class="media-thumb">🎵</div>
        <div class="media-copy">
          <div class="media-name" title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</div>
          <div class="media-meta">ÁUDIO • ${formatShort(media.duration)}</div>
        </div>
        <div class="media-actions">
          <button class="add-chip" data-add-audio="${media.id}" data-target="audio">+ Música</button>
          <button class="add-chip blue" data-add-audio="${media.id}" data-target="voice">+ Voz</button>
        </div>
      </div>`
    )).join('');
    els.audioList.querySelectorAll('[data-add-audio]').forEach((btn) => {
      btn.addEventListener('click', () => addMediaToTimeline(btn.dataset.addAudio, btn.dataset.target));
    });
  }

  /* ─────────────────────────── TRACKS / CLIPS ─────────────────────────── */

  function trackById(id) { return state.project.tracks.find((t) => t.id === id); }
  function findClip(trackId, clipId) {
    const track = trackById(trackId);
    return track ? track.clips.find((c) => c.id === clipId) || null : null;
  }
  function selectedClip() {
    if (!state.selected) return null;
    return findClip(state.selected.trackId, state.selected.clipId);
  }
  function selectedTrack() {
    return state.selected ? trackById(state.selected.trackId) : null;
  }
  function clipEnd(clip) { return clip.start + clip.duration; }
  function trackEnd(track) {
    return track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
  }
  function recalcDuration() {
    let max = 0;
    for (const track of state.project.tracks) {
      for (const clip of track.clips) max = Math.max(max, clipEnd(clip));
    }
    state.duration = Math.max(0.5, max);
    if (state.playhead > state.duration) state.playhead = state.duration;
  }

  function addMediaToTimeline(mediaId, targetTrackId) {
    const media = state.media.get(mediaId);
    if (!media) return;
    let trackId = targetTrackId;
    if (!trackId) trackId = media.type === 'audio' ? 'audio' : 'video';
    const track = trackById(trackId);
    if (!track) return;
    if (media.type === 'audio' && trackId !== 'audio' && trackId !== 'voice') {
      toast('Áudio só pode entrar nas trilhas de música ou voz.', 'error');
      return;
    }
    if (media.type !== 'audio' && !['video', 'overlay'].includes(trackId)) {
      toast('Este clipe só pode entrar nas trilhas de vídeo ou sobreposição.', 'error');
      return;
    }

    const isVideo = media.type === 'video';
    const isImage = media.type === 'image';
    const defaultDuration = isImage ? 5 : Math.max(0.2, media.duration || 5);
    let start;
    if (trackId === 'overlay') start = Math.max(0, state.playhead);
    else if (trackId === 'audio' || trackId === 'voice') start = Math.max(0, state.playhead);
    else start = trackEnd(track);
    const clip = normalizeClip({
      id: uid('clip'),
      mediaId: media.id,
      name: media.name,
      kind: isImage ? 'image' : 'video',
      start,
      in: 0,
      out: defaultDuration,
      speed: 1,
      duration: defaultDuration,
      volume: 1,
      effect: 'none',
      effectIntensity: 100,
      transition: { type: 'none', duration: 0.5 },
      transform: trackId === 'overlay'
        ? { x: 12, y: 12, scale: 0.38, rotate: 0, opacity: 1 }
        : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }
    }, trackId);
    commit(() => {
      track.clips.push(clip);
      state.selected = { trackId, clipId: clip.id };
    });
    toast(`${media.type === 'audio' ? 'Áudio' : 'Clipe'} adicionado à timeline.`, 'success');
    seekPlayhead(start, true);
  }

  function addTextClip(overrides = {}) {
    const base = {
      text: 'Seu texto aqui',
      font: 'Inter',
      size: 64,
      weight: '800',
      color: '#ffffff',
      bg: '#000000',
      bgOpacity: 0,
      stroke: '#000000',
      strokeWidth: 0,
      align: 'center',
      x: 50,
      y: 50,
      animation: 'fade'
    };
    const props = { ...base, ...(overrides || {}) };
    const start = Math.max(0, state.playhead);
    const clip = normalizeClip({
      id: uid('text'),
      mediaId: null,
      name: props.text.split('\n')[0].slice(0, 34) || 'Texto',
      kind: 'text',
      start,
      in: 0,
      out: 4,
      duration: 4,
      speed: 1,
      volume: 1,
      ...props
    }, 'overlay');
    commit(() => {
      trackById('overlay').clips.push(clip);
      state.selected = { trackId: 'overlay', clipId: clip.id };
    });
    showPanel('text');
    toast('Texto adicionado. Edite no inspetor.', 'success');
  }

  function commit(mutator) {
    state.history.push(JSON.stringify(state.project));
    if (state.history.length > 60) state.history.shift();
    state.future = [];
    mutator();
    state.project.updatedAt = Date.now();
    state.editSnapshot = null;
    recalcDuration();
    renderAll();
    scheduleSave();
  }

  function beginEdit() {
    if (!state.editSnapshot) state.editSnapshot = JSON.stringify(state.project);
  }

  function endEdit() {
    if (!state.editSnapshot) return;
    let changed = false;
    try { changed = state.editSnapshot !== JSON.stringify(state.project); } catch { changed = true; }
    if (changed) {
      state.history.push(state.editSnapshot);
      if (state.history.length > 60) state.history.shift();
      state.future = [];
      state.project.updatedAt = Date.now();
      recalcDuration();
    }
    state.editSnapshot = null;
    scheduleSave();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(JSON.stringify(state.project));
    const prev = state.history.pop();
    try {
      state.project = JSON.parse(prev);
      normalizeProject();
      state.selected = null;
      renderAll();
      scheduleSave();
      toast('Desfeito.');
    } catch {}
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(JSON.stringify(state.project));
    const next = state.future.pop();
    try {
      state.project = JSON.parse(next);
      normalizeProject();
      state.selected = null;
      renderAll();
      scheduleSave();
      toast('Refeito.');
    } catch {}
  }

  function selectClip(trackId, clipId) {
    if (!trackId || !clipId) {
      state.selected = null;
    } else {
      state.selected = { trackId, clipId };
    }
    renderTimeline();
    renderInspector();
    updatePanelSelection();
  }

  function splitSelected() {
    const clip = selectedClip();
    if (!clip) {
      toast('Selecione um clipe na timeline para dividir.', 'error');
      return;
    }
    const t = state.playhead;
    if (t <= clip.start + 0.05 || t >= clipEnd(clip) - 0.05) {
      toast('Coloque a agulha dentro do clipe selecionado.', 'error');
      return;
    }
    const track = selectedTrack();
    if (!track) return;
    const local = t - clip.start;
    const right = JSON.parse(JSON.stringify(clip));
    right.id = uid('clip');
    right.name = clip.name;
    right.transition = { type: 'none', duration: 0.5 };
    if (clip.text == null) {
      const splitSource = clip.in + local * clip.speed;
      right.in = splitSource;
      right.out = clip.out;
      right.start = t;
      right.duration = Math.max(0.08, (clip.out - splitSource) / clip.speed);
      clip.out = splitSource;
      clip.duration = Math.max(0.08, (splitSource - clip.in) / clip.speed);
    } else {
      right.start = t;
      right.duration = Math.max(0.08, clipEnd(clip) - t);
      clip.duration = Math.max(0.08, local);
    }
    commit(() => {
      track.clips.push(right);
      state.selected = { trackId: track.id, clipId: right.id };
    });
    toast('Clipe dividido.', 'success');
  }

  function deleteSelected() {
    if (!state.selected) return;
    const { trackId, clipId } = state.selected;
    const track = trackById(trackId);
    if (!track) return;
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx < 0) return;
    commit(() => {
      track.clips.splice(idx, 1);
      state.selected = null;
    });
    toast('Clipe excluído.');
  }

  function duplicateSelected() {
    const clip = selectedClip();
    const track = selectedTrack();
    if (!clip || !track) return;
    const copy = JSON.parse(JSON.stringify(clip));
    copy.id = uid('clip');
    copy.start = Math.max(0, clipEnd(clip) + 0.05);
    copy.transition = { type: 'none', duration: 0.5 };
    commit(() => {
      track.clips.push(copy);
      state.selected = { trackId: track.id, clipId: copy.id };
    });
    toast('Clipe duplicado.', 'success');
  }

  function applyEffect(effectId) {
    const clip = selectedClip();
    if (!clip || clip.text != null || (clip.mediaId && state.media.get(clip.mediaId)?.type === 'audio')) {
      toast('Selecione um clipe de vídeo ou imagem para aplicar o efeito.', 'error');
      return;
    }
    commit(() => {
      clip.effect = effectId;
    });
    toast('Efeito aplicado.', 'success');
  }

  function applyTransition(transId) {
    const clip = selectedClip();
    if (!clip || clip.text != null) {
      toast('Selecione um clipe de vídeo/imagem que tenha um clipe anterior.', 'error');
      return;
    }
    const track = selectedTrack();
    if (!track || track.id !== 'video') {
      toast('Transições são aplicadas na trilha de vídeo.', 'error');
      return;
    }
    const idx = track.clips.findIndex((c) => c.id === clip.id);
    if (idx <= 0) {
      toast('Este é o primeiro clipe; não há clipe anterior para a transição.', 'error');
      return;
    }
    commit(() => {
      clip.transition.type = transId;
    });
    toast('Transição aplicada.', 'success');
  }

  /* ─────────────────────────── RENDER TIMELINE ─────────────────────────── */

  function renderAll() {
    if (!state.project) return;
    els.projectName.value = state.project.name;
    renderAspectButtons();
    renderMediaList();
    renderAudioList();
    renderTrackLabels();
    renderTimeline();
    renderInspector();
    updatePanelSelection();
    updateTTSMeta();
    updateTimeLabels();
    renderPreview();
    renderPreviewEmpty();
    updateAuthUI();
    updateUndoButtons();
  }

  function updateUndoButtons() {
    els.btnUndo.disabled = state.history.length === 0;
    els.btnRedo.disabled = state.future.length === 0;
  }

  function renderTrackLabels() {
    const icons = { video: '🎞', overlay: 'T', audio: '♪', voice: '🎙' };
    els.trackLabels.innerHTML = state.project.tracks.map((track) => (
      `<div class="track-label ${track.id}" style="height:${trackHeight(track.id)}px">
        <span class="track-icon">${icons[track.id] || '•'}</span>
        <span>${escapeHtml(track.name)}</span>
      </div>`
    )).join('');
  }

  function trackHeight(id) {
    return { video: 58, overlay: 44, audio: 48, voice: 48 }[id] || 48;
  }

  function renderTimeline() {
    if (!state.project) return;
    const contentWidth = Math.max(900, (state.duration + 4) * state.zoom + 160);
    els.timelineContent.style.width = `${contentWidth}px`;
    renderRuler(contentWidth);
    els.tracks.innerHTML = state.project.tracks.map((track) => {
      const clips = track.clips
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((clip, idx) => renderClipHtml(track, clip, idx))
        .join('');
      return `<div class="track-row" data-track="${track.id}" style="height:${trackHeight(track.id)}px">${clips}</div>`;
    }).join('');
    updatePlayheadUI();
    updateUndoButtons();
  }

  function renderClipHtml(track, clip, idx) {
    const left = clip.start * state.zoom;
    const width = Math.max(18, clip.duration * state.zoom);
    const isSelected = state.selected && state.selected.trackId === track.id && state.selected.clipId === clip.id;
    const media = clip.mediaId ? state.media.get(clip.mediaId) : null;
    const thumb = media ? state.thumbs.get(media.id) : null;
    const kind = clip.text != null ? 'text' : (track.id === 'voice' ? 'voice' : (media?.type === 'audio' ? 'audio' : 'video'));
    const title = clip.text != null
      ? String(clip.text || 'Texto').split('\n')[0].slice(0, 40)
      : (clip.name || media?.name || 'Clipe');
    const showTransition = clip.transition && clip.transition.type !== 'none' && idx > 0 && track.id === 'video';
    return `<div class="clip ${isSelected ? 'selected' : ''}" data-kind="${kind}" data-track="${track.id}" data-clip="${clip.id}" style="left:${left}px;width:${width}px" title="${escapeHtml(title)}">
      ${thumb ? `<img class="clip-thumb" src="${thumb}" alt="">` : ''}
      <div class="clip-shade"></div>
      ${showTransition ? `<span class="clip-transition" title="${escapeHtml(clip.transition.type)}">⇄</span>` : ''}
      <span class="clip-title">${clip.text != null ? 'T ' : (media?.type === 'audio' ? '♪ ' : '')}${escapeHtml(title)}</span>
      <span class="clip-duration">${formatShort(clip.duration)}</span>
      <span class="trim-handle left" data-handle="left"></span>
      <span class="trim-handle right" data-handle="right"></span>
    </div>`;
  }

  function renderRuler(width) {
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    let step = steps.find((s) => s * state.zoom >= 42) || 120;
    const ticks = [];
    for (let t = 0; t <= width / state.zoom; t += step) {
      const left = t * state.zoom;
      if (left > width) break;
      const major = Math.abs((t / step) % 5) < 0.001;
      ticks.push(`<div class="ruler-tick ${major ? 'major' : ''}" style="left:${left}px">${major ? formatShort(t) : ''}</div>`);
    }
    els.ruler.innerHTML = ticks.join('');
    els.ruler.style.width = `${width}px`;
  }

  function updatePlayheadUI() {
    const left = state.playhead * state.zoom;
    els.playhead.style.left = `${left}px`;
    els.playhead.style.height = `${30 + state.project.tracks.reduce((sum, t) => sum + trackHeight(t.id), 0)}px`;
    updateTimeLabels();
  }

  function updateTimeLabels() {
    els.currentTime.textContent = formatTime(state.playhead);
    els.totalTime.textContent = formatTime(state.duration);
  }

  function setZoom(zoom) {
    state.zoom = clamp(zoom, 20, 240);
    els.timelineZoom.value = state.zoom;
    renderTimeline();
  }

  function setAspect(aspect) {
    if (!ASPECTS[aspect] || state.project.aspect === aspect) return;
    state.project.aspect = aspect;
    state.project.updatedAt = Date.now();
    renderAspectButtons();
    renderPreview();
    scheduleSave();
    toast(`Formato ${aspect} aplicado.`, 'success');
  }

  function snapTime(time, trackId, excludeClipId) {
    if (!state.snap) return time;
    const candidates = [0, state.playhead];
    for (const track of state.project.tracks) {
      for (const clip of track.clips) {
        if (clip.id === excludeClipId) continue;
        candidates.push(clip.start, clipEnd(clip));
      }
    }
    let best = time;
    let bestDist = 0.09;
    for (const candidate of candidates) {
      const dist = Math.abs(time - candidate);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    return Math.max(0, best);
  }

  function updateClipLabels(clipEl, clip) {
    if (!clipEl) return;
    clipEl.style.left = `${clip.start * state.zoom}px`;
    clipEl.style.width = `${Math.max(18, clip.duration * state.zoom)}px`;
    const dur = clipEl.querySelector('.clip-duration');
    if (dur) dur.textContent = formatShort(clip.duration);
    const title = clipEl.querySelector('.clip-title');
    if (title && clip.text != null) title.textContent = `T ${String(clip.text).split('\n')[0].slice(0, 40)}`;
  }

  function startMove(e, clipEl, clip) {
    const trackId = clipEl.dataset.track;
    const startX = e.clientX;
    const origStart = clip.start;
    const historyBefore = JSON.stringify(state.project);
    let moved = false;
    const onMove = (ev) => {
      const dx = (ev.clientX - startX) / state.zoom;
      let nextStart = Math.max(0, origStart + dx);
      nextStart = snapTime(nextStart, trackId, clip.id);
      if (Math.abs(nextStart - clip.start) < 0.0005) return;
      clip.start = nextStart;
      moved = true;
      updateClipLabels(clipEl, clip);
      recalcDuration();
      updateTimeLabels();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) return;
      state.history.push(historyBefore);
      if (state.history.length > 60) state.history.shift();
      state.future = [];
      state.project.updatedAt = Date.now();
      recalcDuration();
      renderTimeline();
      renderInspector();
      renderPreview();
      scheduleSave();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function startTrim(e, clipEl, clip, isLeft) {
    const trackId = clipEl.dataset.track;
    const startX = e.clientX;
    const historyBefore = JSON.stringify(state.project);
    const orig = { start: clip.start, in: clip.in, out: clip.out, duration: clip.duration };
    const media = clip.mediaId ? state.media.get(clip.mediaId) : null;
    const sourceMax = clip.text != null ? 3600 : (media?.duration || Math.max(orig.out + 30, 3600));
    let changed = false;
    const onMove = (ev) => {
      const dx = (ev.clientX - startX) / state.zoom;
      if (isLeft) {
        if (clip.text != null) {
          let nextStart = Math.max(0, orig.start + dx);
          let nextDuration = orig.duration - (nextStart - orig.start);
          if (nextDuration < 0.2) {
            nextDuration = 0.2;
            nextStart = orig.start + orig.duration - 0.2;
          }
          clip.start = nextStart;
          clip.duration = nextDuration;
          clip.in = 0;
          clip.out = nextDuration;
        } else {
          let nextIn = clamp(orig.in + dx * clip.speed, 0, orig.out - 0.05);
          const deltaTimeline = (nextIn - orig.in) / clip.speed;
          clip.in = nextIn;
          clip.start = Math.max(0, orig.start + deltaTimeline);
          clip.out = orig.out;
          clip.duration = Math.max(0.05, (orig.out - nextIn) / clip.speed);
        }
      } else if (clip.text != null) {
        clip.duration = Math.max(0.2, orig.duration + dx);
        clip.out = clip.in + clip.duration;
      } else {
        let nextOut = clamp(orig.out + dx * clip.speed, clip.in + 0.05, sourceMax);
        clip.out = nextOut;
        clip.duration = Math.max(0.05, (nextOut - clip.in) / clip.speed);
      }
      changed = true;
      updateClipLabels(clipEl, clip);
      recalcDuration();
      updateTimeLabels();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!changed) return;
      state.history.push(historyBefore);
      if (state.history.length > 60) state.history.shift();
      state.future = [];
      state.project.updatedAt = Date.now();
      recalcDuration();
      renderTimeline();
      renderInspector();
      renderPreview();
      scheduleSave();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function seekFromPointer(e) {
    const rect = els.ruler.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    seekPlayhead(x / state.zoom);
  }

  function seekPlayhead(time, syncAll = true) {
    state.playhead = clamp(time, 0, Math.max(0, state.duration));
    if (syncAll) syncMedia(state.playhead, state.playing);
    updatePlayheadUI();
    renderPreview();
  }

  /* ─────────────────────────── INSPECTOR ─────────────────────────── */

  function renderInspector() {
    const clip = selectedClip();
    if (!clip) {
      els.inspectorEmpty.hidden = false;
      els.inspectorBody.hidden = true;
      els.inspectorBody.innerHTML = '';
      return;
    }
    els.inspectorEmpty.hidden = true;
    els.inspectorBody.hidden = false;
    const track = selectedTrack();
    const media = clip.mediaId ? state.media.get(clip.mediaId) : null;
    const kind = clip.text != null ? 'TEXTO' : (media?.type === 'audio' ? 'ÁUDIO' : (media?.type === 'image' ? 'IMAGEM' : 'VÍDEO'));
    const title = clip.text != null ? 'Texto' : (clip.name || media?.name || 'Clipe');
    let html = `<div class="inspector-head">
      <h2>${escapeHtml(title)}</h2>
      <span class="type-pill">${kind}</span>
    </div>`;

    html += `<div class="inspector-group">
      <h3>Tempo</h3>
      <div class="inspector-row">
        <label class="inspector-field"><span>Início <b>${clip.start.toFixed(2)}s</b></span>
          <input type="number" data-prop="start" min="0" step="0.01" value="${clip.start.toFixed(2)}">
        </label>
        <label class="inspector-field"><span>Duração <b>${clip.duration.toFixed(2)}s</b></span>
          ${clip.text != null
            ? `<input type="number" data-prop="duration" min="0.2" step="0.01" value="${clip.duration.toFixed(2)}">`
            : `<input type="text" value="${clip.duration.toFixed(2)}s" disabled>`}
        </label>
      </div>
    </div>`;

    if (clip.text != null) {
      html += `<div class="inspector-group">
        <h3>Texto</h3>
        <label class="inspector-field"><span>Conteúdo</span>
          <textarea id="inspText" data-prop="text">${escapeHtml(clip.text)}</textarea>
        </label>
        <div class="inspector-row">
          <label class="inspector-field"><span>Fonte</span>
            <select data-prop="font">
              ${['Inter', 'Georgia', 'Impact', 'Arial', 'Courier New', 'Trebuchet MS'].map((f) => `<option value="${f}" ${clip.font === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </label>
          <label class="inspector-field"><span>Tamanho <b>${clip.size}px</b></span>
            <input type="range" data-prop="size" min="8" max="220" step="1" value="${clip.size}">
          </label>
        </div>
        <div class="inspector-row">
          <label class="inspector-field"><span>Peso</span>
            <select data-prop="weight">
              ${['400', '600', '700', '800', '900'].map((w) => `<option value="${w}" ${clip.weight === w ? 'selected' : ''}>${w}</option>`).join('')}
            </select>
          </label>
          <label class="inspector-field"><span>Alinhamento</span>
            <select data-prop="align">
              <option value="left" ${clip.align === 'left' ? 'selected' : ''}>Esquerda</option>
              <option value="center" ${clip.align === 'center' ? 'selected' : ''}>Centro</option>
              <option value="right" ${clip.align === 'right' ? 'selected' : ''}>Direita</option>
            </select>
          </label>
        </div>
        <div class="inspector-row">
          <label class="inspector-field"><span>Cor</span>
            <div class="color-row"><input type="color" data-prop="color" value="${clip.color}"><input type="text" data-prop="colorText" value="${clip.color}"></div>
          </label>
          <label class="inspector-field"><span>Fundo</span>
            <div class="color-row"><input type="color" data-prop="bg" value="${clip.bg}"><input type="text" data-prop="bgText" value="${clip.bg}"></div>
          </label>
        </div>
        <div class="inspector-row">
          <label class="inspector-field"><span>Opacidade do fundo <b>${Math.round(clip.bgOpacity * 100)}%</b></span>
            <input type="range" data-prop="bgOpacity" min="0" max="100" step="1" value="${Math.round(clip.bgOpacity * 100)}">
          </label>
          <label class="inspector-field"><span>Contorno <b>${clip.strokeWidth}px</b></span>
            <input type="range" data-prop="strokeWidth" min="0" max="20" step="1" value="${clip.strokeWidth}">
          </label>
        </div>
        <div class="inspector-row">
          <label class="inspector-field"><span>Posição X <b>${Math.round(clip.x)}%</b></span>
            <input type="range" data-prop="x" min="0" max="100" step="1" value="${clip.x}">
          </label>
          <label class="inspector-field"><span>Posição Y <b>${Math.round(clip.y)}%</b></span>
            <input type="range" data-prop="y" min="0" max="100" step="1" value="${clip.y}">
          </label>
        </div>
        <label class="inspector-field"><span>Animação</span>
          <select data-prop="animation">
            ${['none', 'fade', 'pop', 'slideup', 'typewriter', 'blur'].map((a) => `<option value="${a}" ${clip.animation === a ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </label>
      </div>`;
    } else if (media?.type === 'audio') {
      html += `<div class="inspector-group">
        <h3>Áudio</h3>
        <div class="inspector-row">
          <label class="inspector-field"><span>Volume <b>${Math.round(clip.volume * 100)}%</b></span>
            <input type="range" data-prop="volume" min="0" max="200" step="1" value="${Math.round(clip.volume * 100)}">
          </label>
          <label class="inspector-field"><span>Velocidade <b>${clip.speed.toFixed(2)}×</b></span>
            <input type="range" data-prop="speed" min="0.5" max="2" step="0.05" value="${clip.speed}">
          </label>
        </div>
        <div class="inspector-row">
          <label class="inspector-field"><span>Fade in <b>${clip.fadeIn.toFixed(1)}s</b></span>
            <input type="range" data-prop="fadeIn" min="0" max="5" step="0.1" value="${clip.fadeIn}">
          </label>
          <label class="inspector-field"><span>Fade out <b>${clip.fadeOut.toFixed(1)}s</b></span>
            <input type="range" data-prop="fadeOut" min="0" max="5" step="0.1" value="${clip.fadeOut}">
          </label>
        </div>
        <label class="inspector-field"><span>Efeito de voz (motor local)</span>
          <select id="inspVoiceFx">
            ${VOICE_FX.map((fx) => `<option value="${fx.id}">${escapeHtml(fx.name)}</option>`).join('')}
          </select>
        </label>
        <button class="mini-action" data-action="applyVoiceFx">Aplicar efeito de voz</button>
      </div>`;
    } else {
      html += `<div class="inspector-group">
        <h3>${media?.type === 'image' ? 'Imagem & movimento' : 'Vídeo & movimento'}</h3>
        <div class="inspector-row">
          <label class="inspector-field"><span>Velocidade <b>${clip.speed.toFixed(2)}×</b></span>
            <input type="range" data-prop="speed" min="0.25" max="4" step="0.05" value="${clip.speed}">
          </label>
          <label class="inspector-field"><span>Volume <b>${Math.round(clip.volume * 100)}%</b></span>
            <input type="range" data-prop="volume" min="0" max="200" step="1" value="${Math.round(clip.volume * 100)}">
          </label>
        </div>
        <label class="inspector-field"><span>Escala <b>${Math.round(clip.transform.scale * 100)}%</b></span>
          <input type="range" data-prop="scale" min="10" max="300" step="1" value="${Math.round(clip.transform.scale * 100)}">
        </label>
        <div class="inspector-row">
          <label class="inspector-field"><span>Posição X <b>${Math.round(clip.transform.x)}%</b></span>
            <input type="range" data-prop="x" min="-100" max="100" step="1" value="${clip.transform.x}">
          </label>
          <label class="inspector-field"><span>Posição Y <b>${Math.round(clip.transform.y)}%</b></span>
            <input type="range" data-prop="y" min="-100" max="100" step="1" value="${clip.transform.y}">
          </label>
        </div>
        <div class="inspector-row">
          <label class="inspector-field"><span>Rotação <b>${Math.round(clip.transform.rotate)}°</b></span>
            <input type="range" data-prop="rotate" min="-180" max="180" step="1" value="${clip.transform.rotate}">
          </label>
          <label class="inspector-field"><span>Opacidade <b>${Math.round(clip.transform.opacity * 100)}%</b></span>
            <input type="range" data-prop="opacity" min="0" max="100" step="1" value="${Math.round(clip.transform.opacity * 100)}">
          </label>
        </div>
      </div>
      <div class="inspector-group">
        <h3>Efeito & transição</h3>
        <label class="inspector-field"><span>Filtro</span>
          <select data-prop="effect">
            ${EFFECTS.map((fx) => `<option value="${fx.id}" ${clip.effect === fx.id ? 'selected' : ''}>${escapeHtml(fx.name)}</option>`).join('')}
          </select>
        </label>
        <label class="inspector-field"><span>Intensidade <b>${Math.round(clip.effectIntensity)}%</b></span>
          <input type="range" data-prop="effectIntensity" min="0" max="100" step="1" value="${clip.effectIntensity}">
        </label>
        <label class="inspector-field"><span>Transição de entrada</span>
          <select data-prop="transitionType">
            ${TRANSITIONS.map((tr) => `<option value="${tr.id}" ${clip.transition.type === tr.id ? 'selected' : ''}>${escapeHtml(tr.name)}</option>`).join('')}
          </select>
        </label>
        <label class="inspector-field"><span>Duração da transição <b>${clip.transition.duration.toFixed(1)}s</b></span>
          <input type="range" data-prop="transitionDuration" min="0.1" max="2" step="0.1" value="${clip.transition.duration}">
        </label>
      </div>`;
    }

    html += `<div class="inspector-actions">
      <button class="mini-action" data-action="duplicate">Duplicar</button>
      <button class="mini-action danger" data-action="delete">Excluir</button>
    </div>`;

    els.inspectorBody.innerHTML = html;

    const applyVoiceBtn = els.inspectorBody.querySelector('[data-action="applyVoiceFx"]');
    if (applyVoiceBtn) applyVoiceBtn.addEventListener('click', applyVoiceFx);

    const colorInputs = els.inspectorBody.querySelectorAll('input[type="color"]');
    colorInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const text = els.inspectorBody.querySelector(`[data-prop="${input.dataset.prop}Text"]`);
        if (text) text.value = input.value;
      });
    });
  }

  function updatePanelSelection() {
    const clip = selectedClip();
    const media = clip?.mediaId ? state.media.get(clip.mediaId) : null;
    $$('.effect-card', els.effectGrid).forEach((card) => {
      card.classList.toggle('active', clip?.effect === card.dataset.effect);
    });
    $$('.transition-card', els.transitionGrid).forEach((card) => {
      card.classList.toggle('active', clip?.transition?.type === card.dataset.transition);
    });
  }

  function updateSelectedProp(prop, rawValue, commitEdit) {
    const clip = selectedClip();
    if (!clip) return;
    const media = clip.mediaId ? state.media.get(clip.mediaId) : null;
    const value = typeof rawValue === 'string' ? rawValue : rawValue;

    switch (prop) {
      case 'start':
        clip.start = Math.max(0, parseNumber(value, clip.start));
        break;
      case 'duration':
        clip.duration = Math.max(0.08, parseNumber(value, clip.duration));
        if (clip.text == null) clip.out = clip.in + clip.duration * clip.speed;
        break;
      case 'text':
        clip.text = String(value);
        clip.name = clip.text.split('\n')[0].slice(0, 34) || 'Texto';
        break;
      case 'font': clip.font = String(value); break;
      case 'size': clip.size = clamp(value, 8, 300); break;
      case 'weight': clip.weight = String(value); break;
      case 'align': clip.align = String(value); break;
      case 'color': clip.color = String(value); break;
      case 'colorText': clip.color = String(value); break;
      case 'bg': clip.bg = String(value); break;
      case 'bgText': clip.bg = String(value); break;
      case 'bgOpacity': clip.bgOpacity = clamp(value, 0, 100) / 100; break;
      case 'strokeWidth': clip.strokeWidth = clamp(value, 0, 30); break;
      case 'x':
        if (clip.text != null) clip.x = clamp(value, 0, 100);
        else clip.transform.x = clamp(value, -100, 100);
        break;
      case 'y':
        if (clip.text != null) clip.y = clamp(value, 0, 100);
        else clip.transform.y = clamp(value, -100, 100);
        break;
      case 'animation': clip.animation = String(value); break;
      case 'volume': clip.volume = clamp(value, 0, 200) / 100; break;
      case 'speed':
        clip.speed = clamp(value, 0.25, 4);
        clip.duration = Math.max(0.08, (clip.out - clip.in) / clip.speed);
        break;
      case 'fadeIn': clip.fadeIn = clamp(value, 0, 10); break;
      case 'fadeOut': clip.fadeOut = clamp(value, 0, 10); break;
      case 'scale': clip.transform.scale = clamp(value, 10, 300) / 100; break;
      case 'rotate': clip.transform.rotate = clamp(value, -180, 180); break;
      case 'opacity': clip.transform.opacity = clamp(value, 0, 100) / 100; break;
      case 'effect': clip.effect = String(value); break;
      case 'effectIntensity': clip.effectIntensity = clamp(value, 0, 100); break;
      case 'transitionType': clip.transition.type = String(value); break;
      case 'transitionDuration': clip.transition.duration = clamp(value, 0.1, 2); break;
      default: return;
    }

    // Atualiza labels do próprio campo sem re-renderizar o inspetor.
    const field = els.inspectorBody.querySelector(`[data-prop="${prop}"]`);
    if (field) {
      const holder = field.closest('.inspector-field')?.querySelector('span b');
      if (holder) {
        if (['size', 'effectIntensity', 'bgOpacity', 'strokeWidth'].includes(prop)) holder.textContent = `${Math.round(Number(value))}${prop === 'size' ? 'px' : '%'}`;
        else if (['x', 'y'].includes(prop)) holder.textContent = `${Math.round(Number(value))}%`;
        else if (prop === 'volume') holder.textContent = `${Math.round(Number(value))}%`;
        else if (prop === 'speed') holder.textContent = `${Number(value).toFixed(2)}×`;
        else if (prop === 'scale') holder.textContent = `${Math.round(Number(value))}%`;
        else if (prop === 'rotate') holder.textContent = `${Math.round(Number(value))}°`;
        else if (prop === 'opacity') holder.textContent = `${Math.round(Number(value))}%`;
        else if (prop === 'fadeIn' || prop === 'fadeOut' || prop === 'transitionDuration') holder.textContent = `${Number(value).toFixed(1)}s`;
        else if (prop === 'start' || prop === 'duration') holder.textContent = `${Number(value).toFixed(2)}s`;
      }
    }

    recalcDuration();
    updateClipElementInTimeline(clip);
    updatePanelSelection();
    renderPreview();
    if (commitEdit) {
      endEdit();
    } else {
      scheduleSave();
    }
    // Atualiza o total e a duração do clipe na timeline.
    updateTimeLabels();
    const totalLabel = els.inspectorBody.querySelector('.inspector-head h2');
    if (totalLabel && clip.text == null && !media) totalLabel.textContent = clip.name;
  }

  function updateClipElementInTimeline(clip) {
    if (!state.selected) return;
    const el = els.tracks.querySelector(`.clip[data-clip="${clip.id}"]`);
    if (!el) return;
    el.style.left = `${clip.start * state.zoom}px`;
    el.style.width = `${Math.max(18, clip.duration * state.zoom)}px`;
    const dur = el.querySelector('.clip-duration');
    if (dur) dur.textContent = formatShort(clip.duration);
    const title = el.querySelector('.clip-title');
    if (title && clip.text != null) title.textContent = `T ${String(clip.text).split('\n')[0].slice(0, 40)}`;
  }

  /* ─────────────────────────── PREVIEW ENGINE ─────────────────────────── */

  function getMediaElement(media) {
    if (!media) return null;
    if (state.mediaElements.has(media.id)) return state.mediaElements.get(media.id);
    let el;
    if (media.type === 'image') {
      el = new Image();
      el.src = media.url;
      el.decoding = 'async';
    } else if (media.type === 'audio') {
      el = document.createElement('audio');
      el.src = media.url;
      el.preload = 'auto';
      el.playsInline = true;
    } else {
      el = document.createElement('video');
      el.src = media.url;
      el.preload = 'auto';
      el.playsInline = true;
      el.muted = false;
      el.loop = false;
    }
    el.crossOrigin = 'anonymous';
    if (media.type !== 'image') {
      const repaint = () => {
        if (!state.playing && !state.exporting) renderPreview();
      };
      el.addEventListener('loadeddata', repaint);
      el.addEventListener('canplay', repaint);
      el.addEventListener('seeked', repaint);
    }
    state.mediaElements.set(media.id, el);
    return el;
  }

  function ensureAudioGraph() {
    if (state.audioCtx) {
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
      return state.audioCtx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    state.audioCtx = new AC();
    state.monitorGain = state.audioCtx.createGain();
    state.monitorGain.gain.value = state.masterVolume;
    state.monitorGain.connect(state.audioCtx.destination);
    state.recordDest = state.audioCtx.createMediaStreamDestination();
    return state.audioCtx;
  }

  function connectMediaElement(el) {
    if (!state.audioCtx || !el || state.mediaNodes.has(el)) return;
    try {
      const node = state.audioCtx.createMediaElementSource(el);
      node.connect(state.monitorGain);
      node.connect(state.recordDest);
      state.mediaNodes.set(el, node);
    } catch (err) {
      // Elemento já conectado ou sem áudio.
    }
  }

  function activeClipsAt(time) {
    const result = { video: [], overlay: [], audio: [], voice: [] };
    for (const track of state.project.tracks) {
      for (const clip of track.clips) {
        if (time >= clip.start - 0.0001 && time < clip.start + clip.duration + 0.0001) {
          result[track.id]?.push(clip);
        }
      }
    }
    return result;
  }

  function transitionWindow(prev, clip) {
    if (!prev || !clip || !clip.transition || clip.transition.type === 'none') return 0;
    const d = Math.min(
      Number(clip.transition.duration) || 0,
      Math.max(0.05, prev.duration / 2),
      Math.max(0.05, clip.duration / 2)
    );
    return d;
  }

  function effectFilterFor(clip) {
    const fx = EFFECTS.find((f) => f.id === clip.effect) || EFFECTS[0];
    if (!fx.filter) return 'none';
    const t = clamp(clip.effectIntensity ?? 100, 0, 100) / 100;
    if (t <= 0) return 'none';
    return interpolateFilter(fx.filter, t);
  }

  function interpolateFilter(filter, t) {
    const neutrals = {
      brightness: 1, contrast: 1, saturate: 1, sepia: 0, grayscale: 0,
      'hue-rotate': 0, blur: 0, invert: 0, opacity: 1
    };
    return String(filter).replace(/([a-z-]+)\(([^)]+)\)/gi, (match, name, value) => {
      const unitMatch = String(value).trim().match(/^(-?[\d.]+)([a-z%]*)$/i);
      if (!unitMatch) return match;
      const num = Number(unitMatch[1]);
      const unit = unitMatch[2] || '';
      const neutral = neutrals[name.toLowerCase()];
      if (neutral == null) return match;
      const mixed = neutral + (num - neutral) * t;
      const rounded = Math.abs(mixed) < 0.001 ? 0 : Number(mixed.toFixed(4));
      return `${name}(${rounded}${unit})`;
    });
  }

  function drawCover(ctx, source, sw, sh, W, H, clip, alpha) {
    if (!sw || !sh) return;
    const transform = clip.transform || { scale: 1, x: 0, y: 0, rotate: 0, opacity: 1 };
    const scale = Math.max(W / sw, H / sh) * (Number(transform.scale) || 1);
    const dw = sw * scale;
    const dh = sh * scale;
    const cx = W / 2 + (Number(transform.x) || 0) * W / 100;
    const cy = H / 2 + (Number(transform.y) || 0) * H / 100;
    ctx.save();
    ctx.globalAlpha = clamp(alpha * (transform.opacity ?? 1), 0, 1);
    ctx.filter = effectFilterFor(clip);
    ctx.translate(cx, cy);
    if (transform.rotate) ctx.rotate((Number(transform.rotate) || 0) * Math.PI / 180);
    ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  function drawClipMedia(ctx, clip, time, alpha, W, H) {
    const media = clip.mediaId ? state.media.get(clip.mediaId) : null;
    if (!media) return;
    const el = getMediaElement(media);
    if (!el) return;
    if (media.type === 'image') {
      if (el.complete && el.naturalWidth) drawCover(ctx, el, el.naturalWidth, el.naturalHeight, W, H, clip, alpha);
      return;
    }
    if (el.readyState < 2) return;
    const sw = el.videoWidth || media.width || W;
    const sh = el.videoHeight || media.height || H;
    drawCover(ctx, el, sw, sh, W, H, clip, alpha);
  }

  function sourceTimeForClip(clip, time) {
    const src = clip.in + Math.max(0, time - clip.start) * clip.speed;
    return clamp(src, clip.in, Math.max(clip.in, clip.out - 0.001));
  }

  function drawTransition(ctx, prev, next, time, W, H) {
    const d = transitionWindow(prev, next);
    if (!d) {
      drawClipMedia(ctx, next, time, 1, W, H);
      return;
    }
    const raw = clamp((time - next.start) / d, 0, 1);
    const type = next.transition.type;
    const ease = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const prevTime = Math.max(prev.start, Math.min(prev.start + prev.duration - 0.02, time));

    if (type === 'fade' || type === 'blur') {
      if (type === 'blur') {
        ctx.save();
        ctx.filter = `blur(${(1 - ease) * 8}px)`;
        drawClipMedia(ctx, prev, prevTime, 1 - ease, W, H);
        ctx.restore();
        drawClipMedia(ctx, next, time, ease, W, H);
      } else {
        drawClipMedia(ctx, prev, prevTime, 1 - ease, W, H);
        drawClipMedia(ctx, next, time, ease, W, H);
      }
      return;
    }
    if (type === 'fadeblack' || type === 'fadewhite') {
      const color = type === 'fadewhite' ? '#ffffff' : '#000000';
      if (ease < 0.5) {
        drawClipMedia(ctx, prev, prevTime, 1 - ease * 2, W, H);
        ctx.save();
        ctx.globalAlpha = ease * 2;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      } else {
        drawClipMedia(ctx, next, time, (ease - 0.5) * 2, W, H);
        ctx.save();
        ctx.globalAlpha = (1 - ease) * 2;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      return;
    }
    if (type === 'flash') {
      drawClipMedia(ctx, prev, prevTime, 1 - ease, W, H);
      drawClipMedia(ctx, next, time, ease, W, H);
      const flash = Math.max(0, 1 - Math.abs(ease - 0.5) * 4);
      ctx.save();
      ctx.globalAlpha = flash * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return;
    }
    if (type === 'glitch') {
      drawClipMedia(ctx, prev, prevTime, 1 - ease, W, H);
      drawClipMedia(ctx, next, time, ease, W, H);
      const jitter = Math.sin(time * 90) * 10 * (1 - Math.abs(ease - 0.5) * 2);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(jitter, 0, W, H);
      ctx.fillStyle = '#ff0044';
      ctx.fillRect(-jitter, 0, W, H);
      ctx.restore();
      return;
    }

    // Transições espaciais
    ctx.save();
    if (type === 'slideleft') {
      ctx.translate(-ease * W, 0);
      drawClipMedia(ctx, prev, prevTime, 1, W, H);
      ctx.translate(W, 0);
      drawClipMedia(ctx, next, time, 1, W, H);
    } else if (type === 'slideright') {
      ctx.translate(ease * W, 0);
      drawClipMedia(ctx, prev, prevTime, 1, W, H);
      ctx.translate(-W, 0);
      drawClipMedia(ctx, next, time, 1, W, H);
    } else if (type === 'slideup') {
      ctx.translate(0, -ease * H);
      drawClipMedia(ctx, prev, prevTime, 1, W, H);
      ctx.translate(0, H);
      drawClipMedia(ctx, next, time, 1, W, H);
    } else if (type === 'slidedown') {
      ctx.translate(0, ease * H);
      drawClipMedia(ctx, prev, prevTime, 1, W, H);
      ctx.translate(0, -H);
      drawClipMedia(ctx, next, time, 1, W, H);
    } else if (type === 'zoomin' || type === 'zoomout') {
      const prevScale = type === 'zoomin' ? 1 + ease * 0.35 : 1 - ease * 0.2;
      const nextScale = type === 'zoomin' ? 1 - (1 - ease) * 0.2 : 1 + (1 - ease) * 0.35;
      drawScaledClip(ctx, prev, prevTime, W, H, prevScale, 1 - ease);
      drawScaledClip(ctx, next, time, W, H, nextScale, ease);
    } else if (type === 'spin') {
      const angle = ease * Math.PI * 0.5;
      ctx.translate(W / 2, H / 2);
      ctx.rotate(angle);
      ctx.globalAlpha = 1 - ease;
      ctx.drawImage(renderToTemp(prev, prevTime, W, H), -W / 2, -H / 2);
      ctx.globalAlpha = ease;
      ctx.rotate(-Math.PI * 0.5 + angle * -1);
      ctx.drawImage(renderToTemp(next, time, W, H), -W / 2, -H / 2);
    } else if (type === 'wipeleft' || type === 'wiperight') {
      drawClipMedia(ctx, prev, prevTime, 1, W, H);
      ctx.beginPath();
      if (type === 'wipeleft') ctx.rect(0, 0, W * ease, H);
      else ctx.rect(W * (1 - ease), 0, W * ease, H);
      ctx.clip();
      drawClipMedia(ctx, next, time, 1, W, H);
    } else {
      drawClipMedia(ctx, prev, prevTime, 1 - ease, W, H);
      drawClipMedia(ctx, next, time, ease, W, H);
    }
    ctx.restore();
  }

  function drawScaledClip(ctx, clip, time, W, H, scale, alpha) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2, -H / 2);
    drawClipMedia(ctx, clip, time, alpha, W, H);
    ctx.restore();
  }

  function renderToTemp(clip, time, W, H) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cx = c.getContext('2d');
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, W, H);
    drawClipMedia(cx, clip, time, 1, W, H);
    return c;
  }

  function drawTextClip(ctx, clip, time, W, H) {
    const elapsed = time - clip.start;
    const progress = clamp(elapsed / Math.max(0.01, clip.duration), 0, 1);
    let alpha = 1;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let blur = 0;
    let visibleText = clip.text || '';

    if (clip.animation === 'fade') {
      alpha = Math.min(1, elapsed / 0.28, (clip.duration - elapsed) / 0.28);
    } else if (clip.animation === 'pop') {
      const p = Math.min(1, elapsed / 0.34);
      const back = 1.70158;
      scale = 1 + (back + 1) * Math.pow(p - 1, 3) + back * Math.pow(p - 1, 2);
      scale = Math.max(0.05, scale);
      alpha = Math.min(1, elapsed / 0.12);
    } else if (clip.animation === 'slideup') {
      const p = Math.min(1, elapsed / 0.35);
      offsetY = (1 - p) * H * 0.06;
      alpha = p;
    } else if (clip.animation === 'typewriter') {
      const chars = Math.max(1, Math.floor((clip.text || '').length * Math.min(1, elapsed / Math.max(0.3, clip.duration * 0.7))));
      visibleText = (clip.text || '').slice(0, chars);
    } else if (clip.animation === 'blur') {
      const p = Math.min(1, elapsed / 0.45);
      blur = (1 - p) * 9;
      alpha = p;
    }

    if (alpha <= 0.002) return;
    const baseW = ASPECTS[state.project.aspect];
    const unit = W / baseW.w;
    const fontSize = clip.size * unit;
    const font = `${clip.weight || 700} ${fontSize}px "${clip.font || 'Inter'}", Inter, Arial, sans-serif`;
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = clip.align || 'center';
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (blur > 0.1) ctx.filter = `blur(${blur * unit}px)`;
    const maxWidth = W * 0.88;
    const lines = wrapText(ctx, visibleText, maxWidth);
    const lineHeight = fontSize * 1.18;
    const blockH = Math.max(lineHeight, lines.length * lineHeight);
    const anchorX = clip.x / 100 * W;
    const anchorY = clip.y / 100 * H;
    const textY0 = -blockH / 2 + lineHeight / 2;
    const bgPadX = fontSize * 0.32;
    const bgPadY = fontSize * 0.2;

    ctx.translate(anchorX + offsetX, anchorY + offsetY);
    ctx.scale(scale, scale);

    if (clip.bgOpacity > 0.001) {
      const widths = lines.map((line) => ctx.measureText(line).width);
      const blockW = Math.max(...widths, fontSize * 0.6);
      const bgX = clip.align === 'left' ? -bgPadX : (clip.align === 'right' ? -blockW - bgPadX : -blockW / 2 - bgPadX);
      roundRect(ctx, bgX, -blockH / 2 - bgPadY, blockW + bgPadX * 2, blockH + bgPadY * 2, fontSize * 0.16);
      ctx.globalAlpha = clamp(alpha * clip.bgOpacity, 0, 1);
      ctx.fillStyle = clip.bg;
      ctx.fill();
      ctx.globalAlpha = clamp(alpha, 0, 1);
    }

    ctx.fillStyle = clip.color;
    if (clip.strokeWidth > 0) {
      ctx.strokeStyle = clip.stroke;
      ctx.lineWidth = clip.strokeWidth * unit;
      ctx.lineJoin = 'round';
    }
    lines.forEach((line, i) => {
      const y = textY0 + i * lineHeight;
      if (clip.strokeWidth > 0) ctx.strokeText(line, 0, y);
      ctx.fillText(line, 0, y);
    });
    ctx.restore();
  }

  function wrapText(ctx, text, maxWidth) {
    const paragraphs = String(text || '').split('\n');
    const lines = [];
    for (const paragraph of paragraphs) {
      if (!paragraph) { lines.push(''); continue; }
      const words = paragraph.split(/\s+/);
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth || !current) {
          current = candidate;
        } else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
    }
    return lines.length ? lines : [''];
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function composeFrame(ctx, W, H, time, options = {}) {
    ctx.save();
    ctx.fillStyle = state.project.background || '#000000';
    ctx.fillRect(0, 0, W, H);
    const active = activeClipsAt(time);
    const videoTrack = trackById('video');
    const videoClips = videoTrack ? videoTrack.clips.slice().sort((a, b) => a.start - b.start) : [];
    let activeIndex = -1;
    for (let i = 0; i < videoClips.length; i++) {
      const c = videoClips[i];
      if (time >= c.start - 0.0001 && time < c.start + c.duration + 0.0001) { activeIndex = i; break; }
    }
    if (activeIndex >= 0) {
      const clip = videoClips[activeIndex];
      const prev = activeIndex > 0 ? videoClips[activeIndex - 1] : null;
      const d = transitionWindow(prev, clip);
      const inTransition = d > 0 && time < clip.start + d;
      if (inTransition) drawTransition(ctx, prev, clip, time, W, H);
      else drawClipMedia(ctx, clip, time, 1, W, H);
    }

    // Sobreposição / texto
    const overlays = active.overlay.slice().sort((a, b) => a.start - b.start);
    for (const clip of overlays) {
      if (clip.text != null) drawTextClip(ctx, clip, time, W, H);
      else drawClipMedia(ctx, clip, time, 1, W, H);
    }

    // Efeitos pós-processados (grão, vinheta, brilho)
    const activeVideo = activeIndex >= 0 ? videoClips[activeIndex] : null;
    if (activeVideo) applyPostEffect(ctx, W, H, activeVideo, time);
    ctx.restore();
  }

  function applyPostEffect(ctx, W, H, clip, time) {
    const fx = EFFECTS.find((f) => f.id === clip.effect);
    if (!fx) return;
    const intensity = clamp(clip.effectIntensity ?? 100, 0, 100) / 100;
    if (fx.id === 'grain_16mm') {
      ctx.save();
      ctx.globalAlpha = 0.08 * intensity;
      for (let i = 0; i < 120; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const s = Math.random() * 2 + 0.5;
        ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
        ctx.fillRect(x, y, s, s);
      }
      ctx.restore();
    }
    if (fx.id === 'glitch_shimmer') {
      const shift = Math.sin(time * 12) * W * 0.004 * intensity;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.08 * intensity;
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(shift, 0, W, H);
      ctx.fillStyle = '#ff2d55';
      ctx.fillRect(-shift, 0, W, H);
      ctx.restore();
    }
    if (fx.id === 'anamorphic_flare') {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, `rgba(56,189,248,${0.05 * intensity})`);
      grad.addColorStop(0.5, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(255,255,255,${0.04 * intensity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    const vignetteEffects = new Set(['cinema_teal', 'moody_wood', 'nightclub_pulse', 'vintage_90s', 'noir_bw']);
    if (vignetteEffects.has(fx.id)) {
      ctx.save();
      const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${0.32 * intensity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function renderPreview() {
    if (!state.previewCtx || !state.project) return;
    composeFrame(state.previewCtx, els.previewCanvas.width, els.previewCanvas.height, state.playhead);
  }

  function renderPreviewEmpty() {
    const hasClips = state.project.tracks.some((track) => track.clips.length > 0);
    els.previewEmpty.classList.toggle('hidden', hasClips);
    els.previewCanvas.style.opacity = hasClips ? '1' : '0.12';
  }

  function syncMedia(time, playing) {
    ensureAudioGraph();
    const active = activeClipsAt(time);
    const wanted = new Map();

    const addWanted = (clip, sourceTime, volume, playbackRate, crossfade = 1) => {
      const media = clip.mediaId ? state.media.get(clip.mediaId) : null;
      if (!media || media.type === 'image') return;
      const el = getMediaElement(media);
      if (!el) return;
      const existing = wanted.get(el);
      if (!existing || (existing.volume * existing.crossfade) < volume * crossfade) {
        wanted.set(el, { sourceTime, volume, playbackRate, crossfade });
      }
    };

    for (const clip of active.video) {
      addWanted(clip, sourceTimeForClip(clip, time), clip.volume, clip.speed);
    }
    for (const clip of active.overlay) {
      if (clip.text == null) addWanted(clip, sourceTimeForClip(clip, time), clip.volume, clip.speed);
    }
    for (const clip of active.audio.concat(active.voice)) {
      let vol = clip.volume;
      const local = time - clip.start;
      if (clip.fadeIn > 0) vol *= clamp(local / clip.fadeIn, 0, 1);
      if (clip.fadeOut > 0) vol *= clamp((clip.duration - local) / clip.fadeOut, 0, 1);
      addWanted(clip, sourceTimeForClip(clip, time), vol, clip.speed);
    }

    // Transição: mantém o frame anterior visível e o áudio do anterior abaixando.
    const videoClips = state.project.tracks.find((t) => t.id === 'video')?.clips.slice().sort((a, b) => a.start - b.start) || [];
    for (let i = 1; i < videoClips.length; i++) {
      const clip = videoClips[i];
      const prev = videoClips[i - 1];
      const d = transitionWindow(prev, clip);
      if (!d) continue;
      if (time >= clip.start && time < clip.start + d) {
        const media = prev.mediaId ? state.media.get(prev.mediaId) : null;
        if (media && media.type !== 'image') {
          const el = getMediaElement(media);
          if (el) {
            const ease = (time - clip.start) / d;
            const existing = wanted.get(el);
            const vol = prev.volume * (1 - ease);
            if (!existing || existing.volume < vol) {
              wanted.set(el, { sourceTime: Math.max(prev.in, prev.out - 0.05), volume: vol, playbackRate: prev.speed, crossfade: 1 });
            }
          }
        }
      }
    }

    for (const [mediaId, el] of state.mediaElements) {
      const media = state.media.get(mediaId);
      if (!media) continue;
      if (!wanted.has(el)) {
        try { el.pause(); } catch {}
      }
    }

    for (const [el, info] of wanted) {
      connectMediaElement(el);
      const media = [...state.media.values()].find((m) => state.mediaElements.get(m.id) === el);
      if (!media) continue;
      const volume = clamp(info.volume * state.masterVolume, 0, 1);
      try {
        el.volume = volume;
        el.playbackRate = clamp(info.playbackRate || 1, 0.25, 4);
        if (playing) {
          if (Math.abs((el.currentTime || 0) - info.sourceTime) > 0.28) {
            el.currentTime = clamp(info.sourceTime, 0, Math.max(0, (el.duration || media.duration || 0) - 0.02));
          }
          if (el.paused) el.play().catch(() => {});
        } else {
          el.pause();
          if (Math.abs((el.currentTime || 0) - info.sourceTime) > 0.03) {
            el.currentTime = clamp(info.sourceTime, 0, Math.max(0, (el.duration || media.duration || 0) - 0.02));
          }
        }
      } catch (err) {
        // Mídia ainda carregando.
      }
    }
  }

  function togglePlay() {
    if (state.playing) pausePlayback();
    else startPlayback();
  }

  function startPlayback() {
    if (state.exporting) return;
    if (state.playhead >= state.duration - 0.02) state.playhead = 0;
    ensureAudioGraph();
    syncMedia(state.playhead, false);
    state.playing = true;
    state.playStartWall = performance.now() - state.playhead * 1000;
    els.btnPlay.querySelector('.icon-play').hidden = true;
    els.btnPlay.querySelector('.icon-pause').hidden = false;
    let last = 0;
    const tick = () => {
      if (!state.playing) return;
      const now = performance.now();
      if (now - last < 1000 / Math.min(60, Math.max(24, state.project.fps))) {
        requestAnimationFrame(tick);
        return;
      }
      last = now;
      const t = (now - state.playStartWall) / 1000;
      if (t >= state.duration) {
        state.playhead = state.duration;
        state.playing = false;
        syncMedia(state.playhead, false);
        updatePlayheadUI();
        renderPreview();
        els.btnPlay.querySelector('.icon-play').hidden = false;
        els.btnPlay.querySelector('.icon-pause').hidden = true;
        return;
      }
      state.playhead = t;
      syncMedia(t, true);
      updatePlayheadUI();
      renderPreview();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function pausePlayback() {
    state.playing = false;
    syncMedia(state.playhead, false);
    els.btnPlay.querySelector('.icon-play').hidden = false;
    els.btnPlay.querySelector('.icon-pause').hidden = true;
    updatePlayheadUI();
    renderPreview();
  }

  /* ─────────────────────────── AUDIO RECORD / TTS ─────────────────────────── */

  async function toggleRecordVoice() {
    if (state.recordStream) {
      stopVoiceRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Seu navegador não suporta gravação de microfone.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.recordStream = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      state.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mime || 'audio/webm' });
        const media = await addMediaFromBlob(blob, `Gravacao-${new Date().toLocaleTimeString('pt-BR').replace(/:/g, '-')}.webm`, 'audio');
        if (media) addMediaToTimeline(media.id, 'voice');
        renderMediaList();
        renderAudioList();
        toast('Gravação adicionada à trilha de voz.', 'success');
      };
      recorder.start(250);
      els.btnRecordVoice.innerHTML = '<span class="rec-dot"></span> Parar gravação';
      els.btnRecordVoice.classList.add('recording');
      toast('Gravando… fale perto do microfone.');
      setTimeout(() => {
        if (state.recordStream) stopVoiceRecording();
      }, 5 * 60 * 1000);
    } catch (err) {
      console.error(err);
      toast('Não foi possível acessar o microfone. Verifique a permissão do navegador.', 'error');
    }
  }

  function stopVoiceRecording() {
    try { state.recorder?.stop(); } catch {}
    try { state.recordStream?.getTracks().forEach((t) => t.stop()); } catch {}
    state.recorder = null;
    state.recordStream = null;
    els.btnRecordVoice.innerHTML = '<span class="rec-dot"></span> Gravar voz do microfone';
    els.btnRecordVoice.classList.remove('recording');
  }

  async function applyVoiceFx() {
    const clip = selectedClip();
    const media = clip?.mediaId ? state.media.get(clip.mediaId) : null;
    if (!clip || !media || media.type !== 'audio') {
      toast('Selecione um clipe de áudio na trilha de voz.', 'error');
      return;
    }
    const inspectSelect = $('#inspVoiceFx', els.inspectorBody);
    const preset = inspectSelect?.value || els.voiceFxSelect.value || 'sensual_whisper';
    await applyVoicePresetToMedia(media, preset);
  }

  async function applyVoicePresetToMedia(media, preset) {
    if (!state.daemonOnline) {
      toast('Motor local offline. Abra o GhostLens/daemon para aplicar efeitos de voz.', 'error');
      return;
    }
    toast('Aplicando efeito de voz no motor local…');
    try {
      const response = await fetch(`${DAEMON}/voice_fx?preset=${encodeURIComponent(preset)}`, {
        method: 'POST',
        headers: { 'Content-Type': media.blob.type || 'audio/mpeg' },
        body: media.blob
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const newMedia = await addMediaFromBlob(blob, `${media.name.replace(/\.[^.]+$/, '')} (${preset}).mp3`, 'audio');
      if (!newMedia) return;
      const clip = selectedClip();
      if (clip && clip.mediaId === media.id) {
        beginEdit();
        clip.mediaId = newMedia.id;
        clip.name = newMedia.name;
        clip.in = 0;
        clip.out = newMedia.duration;
        clip.duration = Math.max(0.08, newMedia.duration / clip.speed);
        endEdit();
        recalcDuration();
        renderAll();
      }
      toast('Efeito de voz aplicado.', 'success');
    } catch (err) {
      console.error(err);
      toast('Falha ao aplicar efeito de voz. O daemon está atualizado?', 'error');
    }
  }

  function updateTTSMeta() {
    const text = els.ttsText.value || '';
    els.ttsCount.textContent = `${text.length} / 2000`;
    const cost = (Math.max(1, text.length) / 100 * 0.005);
    els.ttsCost.textContent = `~$${cost.toFixed(3)}`;
  }

  function initSupabase() {
    try {
      if (window.supabase?.createClient) {
        state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
    } catch (err) {
      console.warn('[editor] Supabase indisponível:', err);
    }
  }

  async function restoreAuth() {
    if (!state.supabase) return;
    try {
      const { data } = await state.supabase.auth.getSession();
      state.user = data?.session?.user || null;
      updateAuthUI();
    } catch {
      state.user = null;
      updateAuthUI();
    }
  }

  function updateAuthUI() {
    const btn = els.btnAccount;
    if (!btn) return;
    if (state.user) {
      const email = String(state.user.email || 'conta');
      btn.textContent = email.length > 22 ? `${email.slice(0, 19)}…` : email;
      btn.title = 'Clique para sair';
      els.ttsLoginNote.textContent = 'Voz IA conectada à sua conta GhostLens.';
      els.ttsLoginNote.style.color = 'var(--muted)';
    } else {
      btn.textContent = 'Entrar';
      btn.title = 'Entrar para usar vozes IA';
      els.ttsLoginNote.textContent = 'Entre na sua conta GhostLens para usar as vozes IA.';
    }
  }

  function openLogin() {
    els.loginError.textContent = '';
    els.loginModal.hidden = false;
    setTimeout(() => els.loginEmail.focus(), 50);
  }

  async function logout() {
    try { await state.supabase?.auth.signOut(); } catch {}
    state.user = null;
    updateAuthUI();
    toast('Sessão encerrada.');
  }

  async function ensureAuth() {
    if (!state.supabase) {
      toast('SDK do Supabase não carregou. Verifique a internet.', 'error');
      return false;
    }
    try {
      const { data } = await state.supabase.auth.getSession();
      state.user = data?.session?.user || null;
    } catch {}
    if (!state.user) {
      openLogin();
      toast('Faça login para gerar vozes IA.', 'error');
      return false;
    }
    return true;
  }

  async function generateTTS() {
    if (state.ttsBusy) return;
    const text = els.ttsText.value.trim();
    if (!text) {
      toast('Digite o texto da narração.', 'error');
      return;
    }
    if (text.length > 2000) {
      toast('Limite de 2000 caracteres por narração.', 'error');
      return;
    }
    if (!(await ensureAuth())) return;
    state.ttsBusy = true;
    const btn = els.btnGenerateTTS;
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Gerando voz…';
    try {
      const { data: sessionData } = await state.supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');

      const voice = els.ttsVoice.value;
      const language = els.ttsLanguage.value;
      const style = VOICE_STYLES.find((s) => s.id === els.ttsStyle.value)?.instruction || '';
      const submit = await fetch(`${CLOUD_API}/wavespeed_proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'tts', text, voice, language, style })
      });
      const submitJson = await submit.json().catch(() => ({}));
      if (!submit.ok) {
        if (submit.status === 403) throw new Error('Sua licença/carteira não libera vozes IA. Ative um plano ou adicione créditos.');
        throw new Error(submitJson.error || 'Falha ao iniciar a voz IA.');
      }
      const job = submitJson.data || submitJson;
      const pollUrl = job.urls?.get || job.urls?.result || job.poll_url;
      if (!pollUrl) throw new Error('A WaveSpeed não retornou a URL de acompanhamento.');

      let audioUrl = '';
      for (let attempt = 0; attempt < 90; attempt++) {
        await sleep(2000);
        const pollRes = await fetch(`${CLOUD_API}/wavespeed_proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'poll', poll_url: pollUrl })
        });
        const pollJson = await pollRes.json().catch(() => ({}));
        if (!pollRes.ok) throw new Error(pollJson.error || 'Falha ao consultar a voz IA.');
        const result = pollJson.data || pollJson;
        if (result.status === 'completed') {
          audioUrl = Array.isArray(result.outputs) ? result.outputs[0] : '';
          break;
        }
        if (['failed', 'cancelled', 'timeout', 'deleted'].includes(result.status)) {
          throw new Error(result.error || 'A geração da voz falhou.');
        }
      }
      if (!audioUrl) throw new Error('A voz IA não ficou pronta em tempo hábil.');

      let blob = null;
      try {
        const audioRes = await fetch(`${CLOUD_API}/wavespeed_proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'fetch_audio', url: audioUrl })
        });
        if (audioRes.ok) blob = await audioRes.blob();
      } catch {}
      if (!blob) {
        const direct = await fetch(audioUrl);
        if (!direct.ok) throw new Error('Falha ao baixar o áudio gerado.');
        blob = await direct.blob();
      }
      const media = await addMediaFromBlob(blob, `Voz-IA-${voice}-${Date.now().toString(36)}.mp3`, 'audio');
      if (media) {
        addMediaToTimeline(media.id, 'voice');
        renderMediaList();
        renderAudioList();
        toast('Voz IA adicionada à trilha de voz.', 'success');
      }
    } catch (err) {
      console.error(err);
      toast(err.message || 'Falha ao gerar voz IA.', 'error');
    } finally {
      state.ttsBusy = false;
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }

  /* ─────────────────────────── DAEMON ─────────────────────────── */

  async function checkDaemon() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`${DAEMON}/status`, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('offline');
      const data = await res.json();
      state.daemonOnline = true;
      state.daemonCheckedAt = Date.now();
        els.serverPill.classList.add('online');
      els.serverPill.classList.remove('offline');
      els.serverLabel.textContent = data.auth?.status === 'authorized' ? 'Motor local online' : 'Motor local • licença inativa';
      if (els.localBanner) els.localBanner.hidden = true;
    } catch {
      state.daemonOnline = false;
      els.serverPill.classList.remove('online');
      els.serverPill.classList.add('offline');
      els.serverLabel.textContent = 'Motor local offline';
      const isLoopback = ['127.0.0.1', 'localhost'].includes(location.hostname);
      if (els.localBanner) els.localBanner.hidden = isLoopback;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ─────────────────────────── EXPORT ─────────────────────────── */

  function openExportModal() {
    if (!state.project.tracks.some((t) => t.clips.length)) {
      toast('Adicione pelo menos um clipe na timeline.', 'error');
      return;
    }
    resetExportModal();
    els.exportModal.hidden = false;
    updateExportSummary();
  }

  function resetExportModal() {
    els.exportSettings.hidden = false;
    els.exportProgress.hidden = true;
    els.exportDone.hidden = true;
    els.exportFill.style.width = '0%';
    els.exportPercent.textContent = '0%';
    els.exportMeta.textContent = '';
    els.exportDoneMeta.textContent = '';
    els.btnStartExport.disabled = false;
    els.btnCancelExport.disabled = false;
    state.exportCancel = false;
    state.exportAborted = false;
    state.exporting = false;
    if (state.exportUrl) {
      URL.revokeObjectURL(state.exportUrl);
      state.exportUrl = '';
    }
  }

  function updateExportSummary() {
    const res = Number(els.exportResolution.value) || 1080;
    const fps = Number(els.exportFps.value) || 30;
    const dims = ASPECTS[state.project.aspect];
    const scale = res / Math.min(dims.w, dims.h);
    const W = even(dims.w * scale);
    const H = even(dims.h * scale);
    const duration = state.duration;
    const estimate = (W * H * fps * duration * 0.08) / (1024 * 1024);
    els.exportSummary.textContent = `${W}×${H} • ${fps} fps • ${formatTime(duration)} • estimativa ${Math.max(1, estimate).toFixed(0)} MB (pode variar). ${state.daemonOnline ? 'Motor local pronto para converter em MP4.' : 'Motor local offline: o Chrome exportará WebM.'}`;
  }

  async function startExport() {
    if (state.exporting) return;
    if (!state.project.tracks.some((t) => t.clips.length)) {
      toast('Nada para exportar.', 'error');
      return;
    }
    const resolution = Number(els.exportResolution.value) || 1080;
    const fps = Number(els.exportFps.value) || 30;
    const preferredFormat = els.exportFormat.value;
    const dims = ASPECTS[state.project.aspect];
    const scale = resolution / Math.min(dims.w, dims.h);
    const W = even(dims.w * scale);
    const H = even(dims.h * scale);
    const duration = state.duration;

    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      toast('Seu navegador não suporta exportação local. Use Chrome ou Edge atualizado.', 'error');
      return;
    }

    await warmUpMedia();

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = W;
    exportCanvas.height = H;
    const exportCtx = exportCanvas.getContext('2d', { alpha: false });
    exportCtx.imageSmoothingEnabled = true;
    exportCtx.imageSmoothingQuality = 'high';

    state.exporting = true;
    state.exportCancel = false;
    state.exportAborted = false;
    state.exportChunks = [];
    state.exportDuration = duration;
    state.exportStart = 0;
    state.playing = false;
    els.btnPlay.querySelector('.icon-play').hidden = false;
    els.btnPlay.querySelector('.icon-pause').hidden = true;
    els.exportSettings.hidden = true;
    els.exportProgress.hidden = false;
    els.exportDone.hidden = true;
    els.exportStatus.textContent = 'Preparando mídias…';
    els.exportMeta.textContent = 'O navegador vai gravar em tempo real. Mantenha esta aba ativa.';
    els.exportFill.style.width = '0%';
    els.exportPercent.textContent = '0%';

    const audioCtx = ensureAudioGraph();
    if (audioCtx && state.monitorGain) state.monitorGain.gain.value = 0;

    try {
      const stream = exportCanvas.captureStream(fps);
      if (state.recordDest?.stream) {
        for (const track of state.recordDest.stream.getAudioTracks()) stream.addTrack(track);
      }
      const candidates = preferredFormat === 'webm'
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
      state.exportMime = mime;
      const recorder = new MediaRecorder(stream, {
        mimeType: mime || undefined,
        videoBitsPerSecond: Math.round(clamp(W * H * fps * 0.1, 2_000_000, 24_000_000)),
        audioBitsPerSecond: 192000
      });
      state.recorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) state.exportChunks.push(e.data);
      };
      recorder.onstop = () => {
        if (state.exportAborted) return;
        const blob = new Blob(state.exportChunks, { type: recorder.mimeType || state.exportMime || 'video/webm' });
        finalizeExport(blob, preferredFormat, W, H, fps);
      };
      recorder.onerror = (e) => {
        console.error('[editor] MediaRecorder:', e.error || e);
        toast('Falha na gravação do vídeo.', 'error');
        abortExport();
      };
      recorder.start(250);
      els.exportStatus.textContent = 'Renderizando vídeo…';
      state.exportStart = performance.now();
      state.playhead = 0;
      syncMedia(0, true);

      const tick = () => {
        if (!state.exporting) return;
        if (state.exportCancel) {
          abortExport();
          return;
        }
        const t = (performance.now() - state.exportStart) / 1000;
        if (t >= state.exportDuration) {
          state.playhead = state.exportDuration;
          composeFrame(exportCtx, W, H, state.exportDuration);
          syncMedia(state.exportDuration, false);
          updatePlayheadUI();
          renderPreview();
          els.exportFill.style.width = '100%';
          els.exportPercent.textContent = '100%';
          els.exportStatus.textContent = 'Finalizando…';
          setTimeout(() => {
            try { recorder.stop(); } catch (err) { console.error(err); }
          }, 350);
          return;
        }
        state.playhead = t;
        syncMedia(t, true);
        composeFrame(exportCtx, W, H, t);
        updatePlayheadUI();
        renderPreview();
        const pct = clamp((t / Math.max(0.01, state.exportDuration)) * 100, 0, 100);
        els.exportFill.style.width = `${pct.toFixed(1)}%`;
        els.exportPercent.textContent = `${Math.round(pct)}%`;
        els.exportMeta.textContent = `${formatTime(t)} de ${formatTime(state.exportDuration)} • ${W}×${H} • ${fps} fps`;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Falha ao exportar.', 'error');
      abortExport();
    }
  }

  async function warmUpMedia() {
    const mediaList = new Set();
    for (const track of state.project.tracks) {
      for (const clip of track.clips) {
        if (clip.mediaId && state.media.has(clip.mediaId)) mediaList.add(state.media.get(clip.mediaId));
      }
    }
    await Promise.all(Array.from(mediaList).map((media) => new Promise((resolve) => {
      if (media.type === 'image') return resolve();
      const el = getMediaElement(media);
      if (!el) return resolve();
      if (el.readyState >= 2) return resolve();
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      el.addEventListener('loadeddata', finish, { once: true });
      el.addEventListener('error', finish, { once: true });
      setTimeout(finish, 3500);
    })));
  }

  async function finalizeExport(blob, preferredFormat, W, H, fps) {
    state.exporting = false;
    state.recorder = null;
    syncMedia(state.playhead, false);
    if (state.audioCtx && state.monitorGain) state.monitorGain.gain.value = state.masterVolume;
    let finalBlob = blob;
    let extension = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
    const wantsMp4 = preferredFormat === 'mp4';
    const isWebm = (blob.type || '').includes('webm');

    if (wantsMp4 && isWebm && state.daemonOnline) {
      els.exportStatus.textContent = 'Convertendo para MP4…';
      els.exportMeta.textContent = 'Usando o FFmpeg do seu computador. Não feche o GhostLens.';
      try {
        const res = await fetch(`${DAEMON}/api/editor/transcode`, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'video/webm' },
          body: blob
        });
        if (!res.ok) throw new Error(await res.text());
        finalBlob = await res.blob();
        extension = 'mp4';
      } catch (err) {
        console.warn('[editor] transcode falhou:', err);
        toast('Não foi possível converter para MP4. O vídeo será baixado em WebM.', 'error');
      }
    }

    const url = URL.createObjectURL(finalBlob);
    state.exportUrl = url;
    const base = slug(state.project.name);
    const filename = `${base}-${W}x${H}-${fps}fps.${extension}`;
    els.btnDownloadExport.href = url;
    els.btnDownloadExport.download = filename;
    els.exportDoneMeta.textContent = `${filename} • ${formatBytes(finalBlob.size)} • ${extension.toUpperCase()}`;
    els.exportStatus.textContent = 'Vídeo pronto';
    els.exportFill.style.width = '100%';
    els.exportPercent.textContent = '100%';
    setTimeout(() => {
      els.exportProgress.hidden = true;
      els.exportDone.hidden = false;
    }, 300);

    try {
      const media = await addMediaFromBlob(finalBlob, filename, 'video');
      if (media) renderMediaList();
    } catch {}
    toast('Exportação concluída.', 'success');
  }

  function abortExport() {
    state.exportCancel = false;
    state.exportAborted = true;
    state.exporting = false;
    try {
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
      state.recorder?.stream?.getTracks?.().forEach((track) => track.stop());
    } catch {}
    state.recorder = null;
    syncMedia(state.playhead, false);
    if (state.audioCtx && state.monitorGain) state.monitorGain.gain.value = state.masterVolume;
    els.exportProgress.hidden = true;
    els.exportSettings.hidden = false;
    els.btnStartExport.disabled = false;
    toast('Exportação cancelada.');
  }

  function cancelExport() {
    if (!state.exporting) {
      els.exportModal.hidden = true;
      return;
    }
    abortExport();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      els.previewShell.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  /* ─────────────────────────── TOAST / MISC ─────────────────────────── */

  function toast(message, type = '', duration = 3400) {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    els.toastWrap.appendChild(node);
    setTimeout(() => {
      node.classList.add('hidden');
      setTimeout(() => node.remove(), 250);
    }, duration);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
