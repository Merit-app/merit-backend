import 'dotenv/config';
import http from 'http';
import { env } from './config/env';
import { initSentry } from './config/sentry';
import { logger } from './lib/logger';
import { redis } from './config/redis';
import { startJobs } from './jobs/index';

initSentry();

async function start() {
  const { app } = await import('./app');
  const server = http.createServer(app);

  // Start BullMQ workers if Redis is available
  if (redis) {
    const { startEmailWorker } = await import('./queues/email.worker');
    const { startSmsWorker } = await import('./queues/sms.worker');
    const { startPdfWorker } = await import('./queues/pdf.worker');
    startEmailWorker();
    startSmsWorker();
    startPdfWorker();
    logger.info('bullmq_workers_started');
  } else {
    logger.info('bullmq_workers_skipped (no REDIS_URL)');
  }

  // Start cron jobs
  startJobs();

  server.listen(env.PORT, () => {
    logger.info(`merit-backend listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  });

  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    if (redis) await redis.quit().catch(() => {});
    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
