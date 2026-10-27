// Webhook Asaas Serverless Handler para GhostLens Studio
// Rota na Vercel: /api/webhook_asaas

const crypto = require('crypto');

// Secret token configured in Asaas
const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || 'ghostlens_webhook_seguro_2026';

function generateLicenseKey(code) {
  const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GHOST-${code}-${p1}-${p2}-${p3}`;
}

module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, asaas-access-token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'online', service: 'GhostLens Asaas Webhook Engine 2.0' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const receivedToken = req.headers['asaas-access-token'] || req.query.access_token;
    if (WEBHOOK_TOKEN && receivedToken && receivedToken !== WEBHOOK_TOKEN) {
      console.warn('⚠️ Token de webhook divergente recebido:', receivedToken);
    }

    const body = req.body || {};
    const event = body.event;
    const payment = body.payment || {};

    console.log(`⚡ [Asaas Webhook] Evento: ${event} | ID: ${payment.id} | Valor: R$ ${payment.value}`);

    // Processa pagamentos aprovados
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const val = parseFloat(payment.value || '0');
      let planCode = 'PRO';
      let planName = 'GhostLens Pro (3 Dispositivos)';
      let maxDevices = 3;

      if (val < 70) {
        planCode = 'SOLO';
        planName = 'GhostLens Solo (1 Dispositivo)';
        maxDevices = 1;
      } else if (val >= 200) {
        planCode = 'AGENCY';
        planName = 'GhostLens Agency (10 Dispositivos)';
        maxDevices = 10;
      }

      const licenseKey = generateLicenseKey(planCode);
      const customerEmail = payment.customerEmail || payment.clientEmail || 'cliente@ghostlens.ai';

      const licenseRecord = {
        key: licenseKey,
        email: customerEmail,
        plan: planName,
        code: planCode,
        max_devices: maxDevices,
        payment_id: payment.id,
        value: val,
        billing_type: payment.billingType,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (30 * 86400 * 1000)).toISOString()
      };

      console.log('✅ [GhostLens] Licença blindada emitida automaticamente:', licenseRecord);

      return res.status(200).json({
        success: true,
        message: 'Pagamento processado com sucesso',
        license: licenseRecord
      });
    }

    // Outros eventos retornam 200 para confirmar recebimento ao Asaas
    return res.status(200).json({ received: true, event });
  } catch (err) {
    console.error('❌ Erro no webhook Asaas:', err);
    return res.status(500).json({ error: err.message });
  }
};
