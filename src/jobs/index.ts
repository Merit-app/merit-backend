import { logger } from '../lib/logger';
import { scheduleFraudScan } from './fraud-scan.job';
import { scheduleCleanup } from './cleanup.job';

export function startJobs(): void {
  scheduleFraudScan();
  scheduleCleanup();
  logger.info('background_jobs_started');
}
