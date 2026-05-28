import cron from 'node-cron';
import { runDailyFraudScan } from '../services/fraud.service';
import { logger } from '../lib/logger';

// Runs daily at 3 AM
export function scheduleFraudScan(): ReturnType<typeof cron.schedule> {
  return cron.schedule('0 3 * * *', async () => {
    logger.info('fraud_scan_started');
    try {
      await runDailyFraudScan();
      logger.info('fraud_scan_completed');
    } catch (err) {
      logger.error({ err }, 'fraud_scan_failed');
    }
  });
}
