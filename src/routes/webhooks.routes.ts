import { Router, Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { processVerificationResponse } from '../services/verifications.service';
import { formatOptOutConfirm } from '../templates/sms/opt-out-confirm';

const router = Router();

function twimlResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}

// POST /webhooks/twilio/inbound — handle SMS replies (YES / NO / STOP)
router.post(
  '/webhooks/twilio/inbound',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Verify the request genuinely came from Twilio. The signature is computed by Twilio
      // over the exact public URL it POSTed to, using the ACCOUNT auth token (not a bespoke
      // "webhook" token). Validated MANDATORILY in production (fail closed): an unauthenticated
      // inbound "YES" must never verify a session by phone number alone (that phone is
      // attacker-supplied, not secret). The URL comes from API_BASE_URL when set, else is
      // derived from the proxy-forwarded request, so this needs no extra config.
      const isProd = env.NODE_ENV === 'production';
      const accountToken = env.TWILIO_AUTH_TOKEN ?? env.TWILIO_WEBHOOK_AUTH_TOKEN;
      const signature = req.headers['x-twilio-signature'] as string | undefined;

      const fwdProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
      const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.get('host');
      const url = env.API_BASE_URL
        ? `${env.API_BASE_URL.replace(/\/$/, '')}/webhooks/twilio/inbound`
        : `${fwdProto ?? req.protocol}://${host}${req.originalUrl}`;

      if (isProd && !accountToken) {
        // No way to authenticate the request — refuse rather than trust attacker input.
        logger.error('twilio_webhook_no_auth_token');
        res.status(503).type('text/xml').send(twimlResponse('Service temporarily unavailable.'));
        return;
      }

      if (accountToken) {
        const valid =
          !!signature &&
          twilio.validateRequest(accountToken, signature, url, req.body as Record<string, string>);
        if (!valid) {
          logger.warn({ url }, 'twilio_signature_invalid');
          res.status(403).type('text/xml').send(twimlResponse('Forbidden'));
          return;
        }
      }
      // (Non-production with no token configured: validation skipped for local testing only.)

      const from: string = req.body.From ?? '';
      const bodyRaw: string = req.body.Body ?? '';
      const keyword = bodyRaw.trim().toUpperCase();

      if (!['YES', 'NO', 'STOP'].includes(keyword)) {
        res.type('text/xml').send(twimlResponse('Reply YES to verify, NO to dispute, or STOP to unsubscribe.'));
        return;
      }

      const response = keyword as 'YES' | 'NO' | 'STOP';
      const result = await processVerificationResponse({ phone: from, response });

      if (!result) {
        res.type('text/xml').send(twimlResponse('No pending verification found for this number.'));
        return;
      }

      let reply: string;
      if (result.handled === 'opt_out') {
        reply = formatOptOutConfirm();
      } else if (result.handled === 'verified') {
        reply = 'Hours verified. Thank you!';
      } else if (result.handled === 'disputed') {
        reply = 'Hours disputed. The student has been notified.';
      } else {
        reply = 'Response recorded. Thank you!';
      }

      logger.info({ from, response, result }, 'twilio_inbound_processed');
      res.type('text/xml').send(twimlResponse(reply));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
