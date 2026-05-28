import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';

/**
 * Runs daily at 5 AM PT — §26 data retention policy.
 *
 * 1. Hard-delete users past their 30-day deletion window.
 * 2. Purge audit log rows older than 7 years.
 * 3. Purge verification rows older than 2 years.
 * 4. Purge IP rate-limit rows older than 24 hours.
 */
export async function processDataRetention(): Promise<void> {
  logger.info('data_retention_started');
  try {
    // 1. Hard-delete users past their 30-day deletion window
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const { data: usersToDelete } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .lt('deletion_scheduled_for', cutoff.toISOString())
      .not('deletion_scheduled_for', 'is', null);

    let hardDeleted = 0;
    for (const user of usersToDelete ?? []) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(user.id);
        // CASCADE in DB will remove all related rows
        logger.info({ userId: user.id }, 'user_hard_deleted');
        hardDeleted++;
      } catch (err) {
        logger.error({ err, userId: user.id }, 'user_hard_delete_failed');
      }
    }

    // 2. Clean up old audit logs (> 7 years)
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    await supabaseAdmin
      .from('audit_log')
      .delete()
      .lt('created_at', sevenYearsAgo.toISOString());

    // 3. Clean up old verifications (> 2 years) — §26 retention table
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    await supabaseAdmin
      .from('verifications')
      .delete()
      .lt('sent_at', twoYearsAgo.toISOString());

    // 4. Clean up IP rate-limit rows older than 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('ip_rate_limits')
      .delete()
      .lt('window_start', oneDayAgo);

    logger.info(
      { hardDeleted, usersFound: usersToDelete?.length ?? 0 },
      'data_retention_completed',
    );
  } catch (err) {
    logger.error({ err }, 'data_retention_failed');
    throw err;
  }
}
