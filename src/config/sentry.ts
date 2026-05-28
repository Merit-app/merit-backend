import { env } from './env';

export function initSentry() {
  if (!env.SENTRY_DSN) return;
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
      integrations: [],
    });
  } catch {
    // Sentry init failure is non-fatal
  }
}

export function captureException(err: unknown, context?: Record<string, any>) {
  if (!env.SENTRY_DSN) return;
  try {
    const Sentry = require('@sentry/node');
    Sentry.withScope((scope: any) => {
      if (context) scope.setContext('extra', context);
      Sentry.captureException(err);
    });
  } catch {
    // ignore
  }
}

export function getSentryRequestHandler() {
  if (!env.SENTRY_DSN) return null;
  try {
    const Sentry = require('@sentry/node');
    return Sentry.Handlers?.requestHandler?.() ?? null;
  } catch {
    return null;
  }
}

export function getSentryErrorHandler() {
  if (!env.SENTRY_DSN) return null;
  try {
    const Sentry = require('@sentry/node');
    return Sentry.Handlers?.errorHandler?.() ?? null;
  } catch {
    return null;
  }
}
