import { twilioClient, TWILIO_MODE } from '../config/twilio';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export async function sendSms(opts: { to: string; body: string }): Promise<{ sid: string }> {
  const result = await twilioClient.messages.create({
    to: opts.to,
    body: opts.body,
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  });

  if (TWILIO_MODE === 'real') {
    logger.info({ to: opts.to, sid: result.sid }, 'sms_sent');
  }

  return { sid: result.sid };
}
