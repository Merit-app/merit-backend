import { env } from './env';

let redisInstance: any = null;

if (env.REDIS_URL) {
  try {
    const { default: Redis } = require('ioredis');
    redisInstance = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisInstance.on('error', (err: Error) => {
      console.warn('[redis] connection error:', err.message);
    });
  } catch {
    redisInstance = null;
  }
}

export const redis = redisInstance as any | null;
