// Planos de licença GhostLens vendidos via Stripe.
// Preços criados no Stripe com lookup_key estável; valores em centavos BRL.
'use strict';

const PLANS = {
  solo: {
    code: 'SOLO',
    plan: 'GhostLens Solo (1 Dispositivo)',
    maxDevices: 1,
    monthly: 4990,
    annual: 47880
  },
  pro: {
    code: 'PRO',
    plan: 'GhostLens Pro (3 Dispositivos)',
    maxDevices: 3,
    monthly: 9700,
    annual: 92400
  },
  agency: {
    code: 'AGENCY',
    plan: 'GhostLens Agency (10 Dispositivos)',
    maxDevices: 10,
    monthly: 30000,
    annual: 288000
  }
};

function normalizePlan(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBilling(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'annual' || v === 'anual' ? 'annual' : 'monthly';
}

function daysForBilling(billing) {
  return normalizeBilling(billing) === 'annual' ? 365 : 30;
}

function lookupKey(plan, billing) {
  return `ghostlens_license_${normalizePlan(plan)}_${normalizeBilling(billing)}`;
}

module.exports = {
  PLANS,
  normalizePlan,
  normalizeBilling,
  daysForBilling,
  lookupKey
};
