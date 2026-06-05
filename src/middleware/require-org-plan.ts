import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase';

type OrgPlan = 'basic' | 'pro' | 'enterprise';

const PLAN_RANK: Record<OrgPlan, number> = {
  basic: 0,
  pro: 1,
  enterprise: 2,
};

/**
 * Express middleware that checks the org's current plan meets
 * the minimum required. Must be used on routes with :orgId param.
 *
 * Returns 403 with { error, code: 'UPGRADE_REQUIRED', currentPlan, requiredPlan }
 * if the org is below the minimum plan.
 */
export function requireOrgPlan(minPlan: OrgPlan) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = (req.params.orgId ?? req.params.id) as string | undefined;

      if (!orgId) {
        return res.status(400).json({ error: 'Missing orgId' });
      }

      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('org_plan, subscription_status')
        .eq('id', orgId)
        .maybeSingle();

      const plan = ((org as any)?.org_plan ?? 'basic') as OrgPlan;
      const planRank = PLAN_RANK[plan] ?? 0;
      const requiredRank = PLAN_RANK[minPlan];

      if (planRank < requiredRank) {
        return res.status(403).json({
          error: `This feature requires the ${minPlan} plan or higher.`,
          code: 'UPGRADE_REQUIRED',
          currentPlan: plan,
          requiredPlan: minPlan,
        });
      }

      return next();
    } catch {
      return res.status(500).json({ error: 'Failed to verify org plan' });
    }
  };
}
