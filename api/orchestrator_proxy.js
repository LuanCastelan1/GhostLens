// ============================================================================
// GhostLens • Orchestrator & Hetzner Proxy (Vercel Serverless Function)
// Rota: /api/orchestrator_proxy
//
// Faz ponte HTTPS segura entre o navegador (ghostlens.cloud) e o servidor Hetzner
// evitando problemas de Mixed Content (HTTPS -> HTTP) e CORS.
// ============================================================================
'use strict';

const HETZNER_URL = (process.env.GHOST_HETZNER_URL || 'http://204.168.235.202:9090').replace(/\/+$/, '');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const targetPath = (req.query.path || (req.body && req.body.endpoint) || '/api/health').replace(/^\/?/, '/');
    const targetUrl = `${HETZNER_URL}${targetPath}`;

    const fetchOptions = {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (req.method === 'POST' && req.body) {
      // Remove campos auxiliares de roteamento antes de repassar
      const payload = { ...req.body };
      delete payload.endpoint;
      fetchOptions.body = JSON.stringify(payload);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout
    fetchOptions.signal = controller.signal;

    const hetznerRes = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);

    const data = await hetznerRes.json().catch(() => ({ status: 'raw', text: '' }));
    return res.status(hetznerRes.status).json(data);
  } catch (err) {
    return res.status(502).json({
      code: 1,
      error: 'hetzner_gateway_timeout_or_error',
      details: err.message
    });
  }
};

