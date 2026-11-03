// ============================================================================
// GhostLens • k6 API-only load test
//
// Somente GETs de health check (respostas pequenas). NÃO cria cobrança,
// não emite licença, não consome créditos.
//
// Uso:
//   VUS=500 HOLD=15s k6 run tools/k6_ghostlens_api.js
//   VUS=1000 HOLD=10s k6 run tools/k6_ghostlens_api.js
// ============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const checksOk = new Rate('checks_ok');
const VUS = Number(__ENV.VUS || 100);

export const options = {
  stages: [
    { duration: __ENV.RAMP || '10s', target: VUS },
    { duration: __ENV.HOLD || '15s', target: VUS },
    { duration: __ENV.DOWN || '5s', target: 0 }
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    checks_ok: ['rate>0.99']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true
};

const BASE = __ENV.BASE_URL || 'https://www.ghostlens.cloud';

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
  const path = HEALTH_APIS[Math.floor(Math.random() * HEALTH_APIS.length)];
  const res = http.get(`${BASE}${path}`, {
    tags: { kind: 'health_api', path }
  });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'latency < 2s': (r) => r.timings.duration < 2000
  });
  checksOk.add(ok);

  sleep(Math.random() * 0.7 + 0.5);
}
