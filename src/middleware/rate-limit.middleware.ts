import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { AppError, RateLimitError } from '../lib/errors';

/** Fail-closed sentinel — returned instead of next() when the rate-limit DB is unreachable. */
function rateLimitUnavailable(next: NextFunction) {
  return next(new AppError('service_unavailable', 'Rate-limit service temporarily unavailable.', 503));
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

      const { data, error } = await supabaseAdmin
        .from('rate_limits')
        .select('count')
        .eq('user_id', req.user.id)
        .eq('action', action)
        .gte('date', windowStart);

      if (error) return rateLimitUnavailable(next);

      const total = (data ?? []).reduce((sum: number, row: { count: number | null }) => sum + (row.count ?? 0), 0);
      if (total >= limits.max) {
        return next(new RateLimitError({ action, limit: limits.max, windowHours }));
      }

      next();
    } catch {
      return rateLimitUnavailable(next);
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

      const { data, error } = await supabaseAdmin
        .from('ip_rate_limits')
        .select('count')
        .eq('ip_address', ip)   // schema column is ip_address, not ip
        .eq('action', action)
        .gte('hour', windowStart); // schema column is hour, not window_start

      if (error) return rateLimitUnavailable(next);

      const total = (data ?? []).reduce((sum: number, row: { count: number | null }) => sum + (row.count ?? 0), 0);
      if (total >= max) {
        return next(new RateLimitError({ action, limit: max, windowHours, ip }));
      }

      next();
    } catch {
      return rateLimitUnavailable(next);
    }
  };
}
