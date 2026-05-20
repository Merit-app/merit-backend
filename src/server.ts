import 'dotenv/config';
import http from 'http';
import { env } from './config/env';
import { initSentry } from './config/sentry';
import { logger } from './lib/logger';

initSentry();

async function start() {
  const { app } = await import('./app');
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info(`merit-backend listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  });

  function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
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
