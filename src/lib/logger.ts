import pino from 'pino';
import { env } from '../config/env';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'body.password',
  'body.token',
  'body.secret',
  'body.apiKey',
  'body.api_key',
  '*.password',
  '*.token',
  '*.secret',
];

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  base: { service: 'merit-backend', env: env.NODE_ENV },
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
});
