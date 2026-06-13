import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { AppError, RateLimitError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Hard ceiling on how long a rate-limit lookup may take. The Supabase query has
 * no inherent timeout, so when the database is unreachable (e.g. a regional
 * cloud incident) the `await` hangs indefinitely and the whole request stalls
 * — including login and token refresh. Racing it against a short timer turns a
 * hang into a fast, handled "store unavailable" error.
 */
const RL_QUERY_TIMEOUT_MS = 2500;

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('rate_limit_query_timeout')), ms);
  });
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    timeout,
  ]) as Promise<T>;
}

/**
 * Actions that stay FAIL-CLOSED when the rate-limit store is unreachable.
 * These are abuse- or cost-sensitive: letting them through during a DB blip
 * could enable email bombing, spam, brute-forcing reset codes, or SMS cost.
 * Everything NOT in this set fails OPEN — a transient DB error must never lock
 * legitimate users out of session-critical routes (token_refresh, login).
 */
const FAIL_CLOSED_ACTIONS = new Set<string>([
  'password_reset',          // reset-link email bombing
  'password_reset_submit',   // brute-forcing reset codes
  'signup',                  // spam account creation
  'resend_confirmation',     // confirmation email bombing
  'resend_verification',     // SMS cost abuse
  'school_lead',             // lead-form spam
  'magic_link',              // supervisor magic-link email bombing
]);

/**
 * Decide what to do when the rate-limit DB query errors. Sensitive actions
 * fail closed (503); the rest fail open (allow + log loudly so blips are
 * visible in Railway logs).
 */
function onRateLimitError(action: string, next: NextFunction, detail: unknown) {
  if (FAIL_CLOSED_ACTIONS.has(action)) {
    logger.error({ action, detail }, 'rate_limit_store_unavailable_fail_closed');
    return next(new AppError('service_unavailable', 'Rate-limit service temporarily unavailable.', 503));
  }
  logger.error({ action, detail }, 'rate_limit_store_unavailable_fail_open');
  return next();
}

/**
 * Best-effort counter increments. These MUST never throw into the request path:
 * a failed write should leave the request untouched (and must not trip the
 * fail-closed 503 on sensitive actions). Without these the middleware only ever
 * reads a counter that nothing writes, so the limits never actually enforce.
 */
async function recordUserHit(userId: string, action: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: row } = await supabaseAdmin
      .from('rate_limits')
      .select('count')
      .eq('user_id', userId)
      .eq('action', action)
      .eq('date', today)
      .maybeSingle();
    await supabaseAdmin
      .from('rate_limits')
      .upsert(
        { user_id: userId, action, date: today, count: ((row as any)?.count ?? 0) + 1 },
        { onConflict: 'user_id,action,date' },
      );
  } catch (err) {
    logger.warn({ action, err: err instanceof Error ? err.message : String(err) }, 'rate_limit_record_failed');
  }
}

async function recordIpHit(ip: string, action: string) {
  try {
    const bucket = new Date();
    bucket.setMinutes(0, 0, 0); // truncate to the hour
    const hour = bucket.toISOString();
    const { data: row } = await supabaseAdmin
      .from('ip_rate_limits')
      .select('count')
      .eq('ip_address', ip)
      .eq('action', action)
      .eq('hour', hour)
      .maybeSingle();
    await supabaseAdmin
      .from('ip_rate_limits')
      .upsert(
        { ip_address: ip, action, hour, count: ((row as any)?.count ?? 0) + 1 },
        { onConflict: 'ip_address,action,hour' },
      );
  } catch (err) {
    logger.warn({ action, err: err instanceof Error ? err.message : String(err) }, 'ip_rate_limit_record_failed');
  }
}

/**
 * Per-user rate limit.
 * Schema: rate_limits(user_id, action, date date, count int)
 * One row per (user, action, day) — summed across the window.
 */
export function rateLimit(action: string, limits: { max: number; windowHours?: number }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (SUPABASE_MODE === 'mock' || !req.user) return next();
    try {
      const windowHours = limits.windowHours ?? 24;
      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10); // 'YYYY-MM-DD' — matches the date column type

      const { data, error } = await withTimeout(
        supabaseAdmin
          .from('rate_limits')
          .select('count')
          .eq('user_id', req.user.id)
          .eq('action', action)
          .gte('date', windowStart),
        RL_QUERY_TIMEOUT_MS,
      );

      if (error) return onRateLimitError(action, next, error.message);

      const total = (data ?? []).reduce((sum: number, row: { count: number | null }) => sum + (row.count ?? 0), 0);
      if (total >= limits.max) {
        return next(new RateLimitError({ action, limit: limits.max, windowHours }));
      }

      void recordUserHit(req.user.id, action); // best-effort, never blocks
      next();
    } catch (err) {
      return onRateLimitError(action, next, err instanceof Error ? err.message : String(err));
    }
  };
}

/**
 * Per-IP rate limit.
 * Schema: ip_rate_limits(ip_address, action, hour timestamptz, count int)
 * One row per (ip, action, hour-bucket) — summed across the window.
 */
export function ipRateLimit(action: string, max: number, windowHours = 1) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (SUPABASE_MODE === 'mock') return next();
    try {
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        req.socket.remoteAddress ??
        'unknown';
      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

      const { data, error } = await withTimeout(
        supabaseAdmin
          .from('ip_rate_limits')
          .select('count')
          .eq('ip_address', ip)   // schema column is ip_address, not ip
          .eq('action', action)
          .gte('hour', windowStart), // schema column is hour, not window_start
        RL_QUERY_TIMEOUT_MS,
      );

      if (error) return onRateLimitError(action, next, error.message);

      const total = (data ?? []).reduce((sum: number, row: { count: number | null }) => sum + (row.count ?? 0), 0);
      if (total >= max) {
        return next(new RateLimitError({ action, limit: max, windowHours, ip }));
      }

      void recordIpHit(ip, action); // best-effort, never blocks
      next();
    } catch (err) {
      return onRateLimitError(action, next, err instanceof Error ? err.message : String(err));
    }
  };
}
