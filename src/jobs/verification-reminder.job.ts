import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { sendSms } from '../services/twilio.service';
import { formatReminderSMS } from '../templates/sms/reminder';

/**
 * Runs daily at 10 AM PT.
 * Finds verifications sent >24h ago that are still pending and not yet reminded,
 * then sends a one-time SMS reminder to the supervisor.
 */
export async function sendVerificationReminders(): Promise<void> {
  logger.info('verification_reminders_started');
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Find SMS verifications sent >24h ago, still pending, not yet reminded
    const { data: pending } = await supabaseAdmin
      .from('verifications')
      .select(
        'id, supervisor_phone, supervisor_name, session_id, sessions!inner(user_id, hours, status, date, organizations(name))',
      )
      .eq('channel', 'sms')
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

        const body = formatReminderSMS({
          supervisorName: v.supervisor_name ?? 'Supervisor',
          studentName: (student as any)?.name ?? 'a student',
          hours: Number(session.hours),
          orgName: session.organizations?.name ?? 'their organization',
        });

        // sendSms handles real vs mock internally
        await sendSms({ to: v.supervisor_phone, body });

        // Mark as reminded so we don't send again
        await supabaseAdmin
          .from('verifications')
          .update({ reminded_at: new Date().toISOString() })
          .eq('id', v.id);

        sent++;
        logger.info({ verificationId: v.id, to: v.supervisor_phone }, 'reminder_sent');
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
