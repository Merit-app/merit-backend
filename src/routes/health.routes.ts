import { Router } from 'express';
import { SUPABASE_MODE } from '../config/supabase';
import { TWILIO_MODE } from '../config/twilio';
import { RESEND_MODE } from '../config/resend';
import { STRIPE_MODE } from '../config/stripe';
import { redis } from '../config/redis';

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
      queue: redis ? 'real' : 'none',
    },
    version: process.env.npm_package_version ?? '1.0.0',
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/ready', (_req, res) => {
  // In mock mode all services are trivially "ready"
  res.json({ status: 'ready' });
});


export default router;
