import { Request, Response, NextFunction } from 'express';
import { Plan, PLAN_FEATURES } from '../config/plans';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

export function requirePlan(...plans: Plan[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!plans.includes(req.user.plan as Plan)) {
      return next(new ForbiddenError(`Requires plan: ${plans.join(' or ')}`));
    }
    next();
  };
}

export function requireFeature(feature: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    const allowed = PLAN_FEATURES[feature];
    if (!allowed) return next(new ForbiddenError(`Unknown feature: ${feature}`));
    if (!allowed.includes(req.user.plan as Plan)) {
      return next(new ForbiddenError(`Feature '${feature}' not available on your plan`));
    }
    next();
  };
}
