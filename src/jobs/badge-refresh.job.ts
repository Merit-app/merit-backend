import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { computeBadgesForUser } from '../services/badges.service';
import { logger } from '../lib/logger';

/**
 * Nightly badge refresh job.
 * Iterates all users (in batches of 100) and re-computes badges for each.
 * Safe to run multiple times — computeBadgesForUser is idempotent.
 */
export async function refreshAllBadges(): Promise<void> {
  if (SUPABASE_MODE === 'mock') {
    logger.info('badge_refresh_skipped_mock_mode');
    return;
  }

  const BATCH = 100;
  let offset = 0;
  let totalUsers = 0;
  let totalEarned = 0;
  let errors = 0;

  logger.info('badge_refresh_started');

  while (true) {
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .range(offset, offset + BATCH - 1);

    if (error) {
      logger.error({ err: error }, 'badge_refresh_fetch_users_error');
      break;
    }

    if (!users || users.length === 0) break;

    for (const user of users) {
      try {
        const earned = await computeBadgesForUser(user.id);
        totalEarned += earned.length;
      } catch (err) {
        errors++;
        logger.error({ err, userId: user.id }, 'badge_refresh_user_error');
      }
    }

    totalUsers += users.length;
    if (users.length < BATCH) break;
    offset += BATCH;
  }

  logger.info({ totalUsers, totalEarned, errors }, 'badge_refresh_completed');
}
