// Webhook Stripe Serverless Handler para GhostLens Studio
// Rota na Vercel: /api/webhook_stripe

const crypto = require('crypto');

function generateLicenseKey(code) {
  const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GHOST-${code}-${p1}-${p2}-${p3}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'online', service: 'GhostLens Stripe Webhook Engine 2.0' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body || {};
    console.log(`⚡ [Stripe Webhook] Evento: ${event.type} | ID: ${event.id}`);

    if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
      const session = event.data?.object || {};
      const amount = session.amount_total || session.amount_paid || 0; // centavos
      const customerEmail = session.customer_details?.email || session.customer_email || 'cliente@ghostlens.ai';

      let planCode = 'PRO';
      let planName = 'GhostLens Pro (3 Dispositivos)';
      let maxDevices = 3;

      if (amount < 7000) {
        planCode = 'SOLO';
        planName = 'GhostLens Solo (1 Dispositivo)';
        maxDevices = 1;
      } else if (amount >= 20000) {
        planCode = 'AGENCY';
        planName = 'GhostLens Agency (10 Dispositivos)';
        maxDevices = 10;
      }

      const licenseKey = generateLicenseKey(planCode);

      const licenseRecord = {
        key: licenseKey,
        email: customerEmail,
        plan: planName,
        code: planCode,
        max_devices: maxDevices,
        provider: 'stripe',
        session_id: session.id,
        amount_brl: (amount / 100).toFixed(2),
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (30 * 86400 * 1000)).toISOString()
      };

      console.log('✅ [GhostLens] Licença blindada emitida via Stripe:', licenseRecord);

      return res.status(200).json({
        success: true,
        message: 'Pagamento Stripe processado com sucesso',
        license: licenseRecord
      });
    }

    return res.status(200).json({ received: true, type: event.type });
  } catch (err) {
    console.error('❌ Erro no webhook Stripe:', err);
    return res.status(500).json({ error: err.message });
  }
};
