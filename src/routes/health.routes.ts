import { Router } from 'express';
import { SUPABASE_MODE } from '../config/supabase';
import { TWILIO_MODE } from '../config/twilio';
import { RESEND_MODE } from '../config/resend';
import { STRIPE_MODE } from '../config/stripe';
import { env } from '../config/env';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    mode: {
      supabase: SUPABASE_MODE,
      twilio: TWILIO_MODE,
      resend: RESEND_MODE,
      stripe: STRIPE_MODE,
    },
    version: process.env.npm_package_version ?? '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/ready', (_req, res) => {
  // In mock mode all services are trivially "ready"
  res.json({ status: 'ready' });
});

// Temporary diagnostic: test GoTrue connectivity from Railway.
// Remove after signup issue is diagnosed.
router.get('/health/gotrue', async (_req, res) => {
  const rawUrl = env.SUPABASE_URL ?? '(not set)';
  const supabaseUrl = rawUrl.replace(/\/+$/, '').replace(/\/(rest|auth)\/v\d+.*$/, '');
  const gotrueUrl = `${supabaseUrl}/auth/v1/admin/users`;
  try {
    const resp = await fetch(gotrueUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      },
    });
    const body = await resp.text();
    res.json({
      rawUrlSuffix: rawUrl.slice(-30),   // last 30 chars to see if path is included
      gotrueUrl,
      supabaseUrlPattern: supabaseUrl.replace(/[a-z0-9]{20,}/gi, '[REDACTED]'),
      httpStatus: resp.status,
      responseSnippet: body.slice(0, 200),
    });
  } catch (err: any) {
    res.json({ gotrueUrl, error: err.message });
  }
});

export default router;
