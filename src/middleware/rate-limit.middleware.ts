import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { AppError, RateLimitError } from '../lib/errors';

/** Fail-closed sentinel — returned instead of next() when the rate-limit DB is unreachable. */
function rateLimitUnavailable(next: NextFunction) {
  return next(new AppError('service_unavailable', 'Rate-limit service temporarily unavailable.', 503));
}

export function rateLimit(action: string, limits: { max: number; windowHours?: number }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (SUPABASE_MODE === 'mock' || !req.user) return next();
    try {
      const windowHours = limits.windowHours ?? 24;
      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabaseAdmin
        .from('rate_limits')
        .select('count')
        .eq('user_id', req.user.id)
        .eq('action', action)
        .gte('window_start', windowStart)
        .maybeSingle();

      // Fail closed — if we can't check the limit, refuse the request
      if (error) return rateLimitUnavailable(next);

      const currentCount = data?.count ?? 0;
      if (currentCount >= limits.max) {
        return next(new RateLimitError({ action, limit: limits.max, windowHours }));
      }

      next();
    } catch {
      // Fail closed
      return rateLimitUnavailable(next);
    }
  };
}

export function ipRateLimit(action: string, max: number, windowHours = 1) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (SUPABASE_MODE === 'mock') return next();
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabaseAdmin
        .from('ip_rate_limits')
        .select('count')
        .eq('ip', ip)
        .eq('action', action)
        .gte('window_start', windowStart)
        .maybeSingle();

      // Fail closed — if we can't check the limit, refuse the request
      if (error) return rateLimitUnavailable(next);

      const currentCount = data?.count ?? 0;
      if (currentCount >= max) {
        return next(new RateLimitError({ action, limit: max, windowHours, ip }));
      }

      next();
    } catch {
      // Fail closed
      return rateLimitUnavailable(next);
    }
  };
}
