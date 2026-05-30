import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware that validates one or more route params are valid UUIDs.
 * Returns HTTP 400 if any named param is present but not a valid UUID v4/v1 format.
 *
 * Usage:
 *   router.get('/sessions/:id', validateUuidParam('id'), handler)
 *   router.delete('/admin/members/:memberId', validateUuidParam('memberId'), handler)
 */
export function validateUuidParam(...params: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const name of params) {
      const value = req.params[name];
      if (typeof value === 'string' && !UUID_RE.test(value)) {
        return next(new AppError('invalid_param', `${name} must be a valid UUID`, 400));
      }
    }
    next();
  };
}
