import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { twilioClient, TWILIO_MODE } from '../config/twilio';
import { formatReminderSMS } from '../templates/sms/reminder';
import { env } from '../config/env';

/**
 * Runs daily at 10 AM PT.
 * Finds sessions with pending verifications that are older than 24 hours and
 * sends a one-time SMS reminder to the supervisor.
 */
export async function sendVerificationReminders(): Promise<void> {
  logger.info('verification_reminders_started');
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Find verifications sent >24h ago that are still pending and not yet reminded
    const { data: pending } = await supabaseAdmin
      .from('verifications')
      .select(
        'id, supervisor_phone, supervisor_name, session_id, sessions!inner(user_id, hours, status, date, organizations(name))',
      )
      .eq('method', 'sms')
      .is('reminded_at', null)
      .lt('sent_at', cutoff)
      .eq('sessions.status', 'pending');

    const list = (pending as any[]) ?? [];
    let sent = 0;

    for (const v of list) {
      const session = (v as any).sessions;
      if (!session || !v.supervisor_phone) continue;

      try {
        // Fetch student name
        const { data: student } = await supabaseAdmin
          .from('users')
          .select('name')
          .eq('id', session.user_id)
          .maybeSingle();

        const smsBody = formatReminderSMS({
          supervisorName: v.supervisor_name ?? 'Supervisor',
          studentName: (student as any)?.name ?? 'a student',
          hours: Number(session.hours),
          orgName: session.organizations?.name ?? 'their organization',
        });

        if (TWILIO_MODE === 'real') {
          await twilioClient.messages.create({
            body: smsBody,
            from: env.TWILIO_MESSAGING_SERVICE_SID
              ? undefined
              : env.TWILIO_PHONE_NUMBER,
            messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID ?? undefined,
            to: v.supervisor_phone,
          });
        } else {
          logger.info({ to: v.supervisor_phone, body: smsBody }, '[MOCK_SMS] reminder');
        }

        // Mark as reminded so we don't send again
        await supabaseAdmin
          .from('verifications')
          .update({ reminded_at: new Date().toISOString() })
          .eq('id', v.id);

        sent++;
      } catch (err) {
        logger.error({ err, verificationId: v.id }, 'reminder_sms_failed');
      }
    }

    logger.info({ sent, total: list.length }, 'verification_reminders_completed');
  } catch (err) {
    logger.error({ err }, 'verification_reminders_failed');
    throw err;
  }
}
