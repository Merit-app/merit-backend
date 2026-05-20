import cron from 'node-cron';
import { logger } from '../lib/logger';
import { sendWeeklyDigest } from './weekly-digest.job';
import { sendVerificationReminders } from './verification-reminder.job';
import { refreshTrustScores } from './trust-score-refresh.job';
import { runDailyFraudScan } from '../services/fraud.service';
import { scheduleCleanup, cleanupIpRateLimits } from './cleanup.job';
import { processMilestones } from './milestone.job';
import { processDataRetention } from './data-retention.job';

const TZ = 'America/Los_Angeles';

/**
 * Register all background cron jobs.
 * All schedules use America/Los_Angeles (PT) per §20.
 */
export function registerJobs(): void {
  // Sundays at 9 AM PT — weekly digest email to all active users
  cron.schedule('0 9 * * 0', async () => {
    try { await sendWeeklyDigest(); } catch (err) { logger.error({ err }, 'weekly_digest_job_error'); }
  }, { timezone: TZ });

  // Daily at 10 AM PT — SMS reminders for pending verifications > 24h old
  cron.schedule('0 10 * * *', async () => {
    try { await sendVerificationReminders(); } catch (err) { logger.error({ err }, 'verification_reminder_job_error'); }
  }, { timezone: TZ });

  // Daily at 2 AM PT — refresh org email domain trust scores
  cron.schedule('0 2 * * *', async () => {
    try { await refreshTrustScores(); } catch (err) { logger.error({ err }, 'trust_score_refresh_job_error'); }
  }, { timezone: TZ });

  // Daily at 3 AM PT — fraud anomaly scan
  cron.schedule('0 3 * * *', async () => {
    logger.info('fraud_scan_started');
    try { await runDailyFraudScan(); logger.info('fraud_scan_completed'); }
    catch (err) { logger.error({ err }, 'fraud_scan_job_error'); }
  }, { timezone: TZ });

  // Daily at 4 AM PT — cleanup expired verifications, stale rate-limit rows, old notifications
  scheduleCleanup();

  // Daily at 5 AM PT — GDPR / PIPEDA data retention (hard-delete, purge old records)
  cron.schedule('0 5 * * *', async () => {
    try { await processDataRetention(); } catch (err) { logger.error({ err }, 'data_retention_job_error'); }
  }, { timezone: TZ });

  // Daily at 6 AM PT — goal milestone emails (25 / 50 / 75 / 100 %)
  cron.schedule('0 6 * * *', async () => {
    try { await processMilestones(); } catch (err) { logger.error({ err }, 'milestone_job_error'); }
  }, { timezone: TZ });

  // Hourly — purge ip_rate_limits rows older than 24 hours (§26 data retention)
  cron.schedule('0 * * * *', async () => {
    try { await cleanupIpRateLimits(); } catch (err) { logger.error({ err }, 'ip_rate_limit_cleanup_error'); }
  });

  logger.info('background_jobs_registered');
}
