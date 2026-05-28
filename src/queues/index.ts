import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../lib/logger';

// When Redis is unavailable we export null queues and skip worker startup.
// Callers must guard with `if (emailQueue)`.
export const QUEUE_MODE: 'real' | 'mock' = redis ? 'real' : 'mock';

function makeConnection(): ConnectionOptions {
  return redis as unknown as ConnectionOptions;
}

function makeQueue(name: string): Queue | null {
  if (!redis) return null;
  const q = new Queue(name, { connection: makeConnection() });
  q.on('error', (err) => logger.warn({ queue: name, err: err.message }, 'queue_error'));
  return q;
}

export const emailQueue = makeQueue('email');
export const smsQueue = makeQueue('sms');
export const pdfQueue = makeQueue('pdf');

export { makeConnection };
