import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { recalculateDomainTrust } from '../services/trust.service';

/**
 * Runs daily at 2 AM PT.
 * Re-scores every domain in org_email_domains so trust levels reflect
 * the latest verification outcomes and authenticator counts.
 */
export async function refreshTrustScores(): Promise<void> {
  logger.info('trust_score_refresh_started');
  try {
    // Fetch all non-blocked, non-personal domains
    const { data: domains } = await supabaseAdmin
      .from('org_email_domains')
      .select('domain')
      .eq('manually_blocked', false)
      .neq('domain_type', 'personal');

    const domainList = (domains as any[]) ?? [];
    let refreshed = 0;
    let failed = 0;

    for (const row of domainList) {
      try {
        await recalculateDomainTrust(row.domain);
        refreshed++;
      } catch (err) {
        logger.error({ err, domain: row.domain }, 'trust_score_refresh_domain_failed');
        failed++;
      }
    }

    logger.info({ refreshed, failed, total: domainList.length }, 'trust_score_refresh_completed');
  } catch (err) {
    logger.error({ err }, 'trust_score_refresh_failed');
    throw err;
  }
}
