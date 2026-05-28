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
      // Validate Twilio signature when auth token is configured
      const authToken = env.TWILIO_WEBHOOK_AUTH_TOKEN;
      if (authToken) {
        const signature = req.headers['x-twilio-signature'] as string;
        const url = `${env.API_BASE_URL}/webhooks/twilio/inbound`;
        const valid = twilio.validateRequest(authToken, signature, url, req.body as Record<string, string>);
        if (!valid) {
          logger.warn({ url }, 'twilio_signature_invalid');
          res.status(403).type('text/xml').send(twimlResponse('Forbidden'));
          return;
        }
      }

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
