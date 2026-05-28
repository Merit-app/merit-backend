import { Request, Response, NextFunction } from 'express';
import { Plan, PLAN_FEATURES, PLAN_HIERARCHY } from '../config/plans';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

/**
 * Require a minimum plan tier (hierarchy-based).
 * Returns a structured 403 that the frontend can parse for upgrade prompts.
 *
 * Usage: router.get('/some-route', requirePlan('pro'), handler)
 */
export function requirePlan(minimumPlan: Plan) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    const userPlan = (req.user.plan ?? 'free') as Plan;
    const userLevel = PLAN_HIERARCHY[userPlan] ?? 0;
    const requiredLevel = PLAN_HIERARCHY[minimumPlan] ?? 0;

    if (userLevel < requiredLevel) {
      res.status(403).json({
        error: 'upgrade_required',
        message: `This feature requires a ${minimumPlan} plan or higher.`,
        requiredPlan: minimumPlan,
        currentPlan: userPlan,
      });
      return;
    }
    next();
  };
}

/**
 * Require that the user's plan is in the PLAN_FEATURES allow-list for a feature key.
 * More granular than requirePlan — useful for feature flags that skip tiers.
 */
export function requireFeature(feature: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    const allowed = PLAN_FEATURES[feature];
    if (!allowed) return next(new ForbiddenError(`Unknown feature: ${feature}`));
    const userPlan = (req.user.plan ?? 'free') as Plan;
    if (!allowed.includes(userPlan)) {
      return next(new ForbiddenError(`Feature '${feature}' is not available on your current plan`));
    }
    next();
  };
}
