// ============================================================================
// GhostLens • k6 smoke/load test (somente GETs seguros)
//
// Testa páginas e health checks. NÃO chama endpoints que criam cobrança,
// emitem licença ou consomem créditos.
//
// Uso:
//   k6 run tools/k6_ghostlens_smoke.js
//   BASE_URL=https://www.ghostlens.cloud k6 run tools/k6_ghostlens_smoke.js
// ============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const checksOk = new Rate('checks_ok');
const VUS = Number(__ENV.VUS || 30);

export const options = {
  stages: [
    { duration: __ENV.RAMP || '10s', target: VUS },
    { duration: __ENV.HOLD || '20s', target: VUS },
    { duration: __ENV.DOWN || '5s', target: 0 }
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    checks_ok: ['rate>0.98']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true
};

const BASE = __ENV.BASE_URL || 'https://www.ghostlens.cloud';

const PAGES = [
  '/',
  '/download',
  '/pix',
  '/studio',
  '/obrigado',
  '/proposta'
];

const HEALTH_APIS = [
  '/api/license_session',
  '/api/verify_license',
  '/api/create_license_checkout',
  '/api/create_credit_pix',
  '/api/create_license_pix',
  '/api/wavespeed_proxy',
  '/api/license_lookup',
  '/api/webhook_stripe',
  '/api/webhook_asaas'
];

export default function () {
  const isPage = Math.random() < 0.7;
  const list = isPage ? PAGES : HEALTH_APIS;
  const path = list[Math.floor(Math.random() * list.length)];

  const res = http.get(`${BASE}${path}`, {
    tags: { kind: isPage ? 'page' : 'health_api', path }
  });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'latency < 2s': (r) => r.timings.duration < 2000
  });
  checksOk.add(ok);

  sleep(Math.random() * 1.2 + 0.3);
}
