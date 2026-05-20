import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';

// ─── Daily cleanup (4 AM PT) ──────────────────────────────────────────────────

export function scheduleCleanup(): ReturnType<typeof cron.schedule> {
  return cron.schedule('0 4 * * *', async () => {
    logger.info('cleanup_job_started');
    try {
      const now = new Date().toISOString();

      // Hard-delete accounts scheduled for deletion whose grace period has passed
      const { data: deleted } = await supabaseAdmin
        .from('users')
        .select('id')
        .not('deletion_scheduled_for', 'is', null)
        .lte('deletion_scheduled_for', now);

      if (deleted?.length) {
        for (const user of deleted) {
          await supabaseAdmin.auth.admin.deleteUser(user.id).catch(() => {});
          await supabaseAdmin.from('users').delete().eq('id', user.id);
          logger.info({ userId: user.id }, 'account_hard_deleted');
        }
      }

      // Purge per-user rate_limit rows older than 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      await supabaseAdmin.from('rate_limits').delete().lt('date', sevenDaysAgo);

      // Purge notifications older than 90 days
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      await supabaseAdmin.from('notifications').delete().lt('created_at', ninetyDaysAgo);

      logger.info({ deletedAccounts: deleted?.length ?? 0 }, 'cleanup_job_completed');
    } catch (err) {
      logger.error({ err }, 'cleanup_job_failed');
    }
  });
}

// ─── Hourly ip_rate_limits cleanup ────────────────────────────────────────────
// §26 data retention: IP rate limit rows kept for 24 hours only.
// Called directly by registerJobs() on an hourly cron.

export async function cleanupIpRateLimits(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from('ip_rate_limits')
    .delete()
    .lt('window_start', cutoff);
  logger.debug({ cutoff }, 'ip_rate_limits_cleaned');
}
