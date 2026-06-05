import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { stripe, STRIPE_MODE } from '../config/stripe';
import { supabaseAdmin } from '../config/supabase';
import { requireAuth } from '../middleware/auth.middleware';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { success } from '../utils/shape';

const router = Router();

// Price-key → env var
const ORG_PRICES = {
  pro_monthly: () => env.ORG_PRO_MONTHLY_PRICE_ID,
  pro_yearly: () => env.ORG_PRO_YEARLY_PRICE_ID,
  enterprise_monthly: () => env.ORG_ENTERPRISE_MONTHLY_PRICE_ID,
  enterprise_yearly: () => env.ORG_ENTERPRISE_YEARLY_PRICE_ID,
} as const;

// Log configured org price IDs at startup so Railway logs confirm the env vars are set
logger.info({
  org_pro_monthly: env.ORG_PRO_MONTHLY_PRICE_ID ?? '⚠️  NOT SET',
  org_pro_yearly: env.ORG_PRO_YEARLY_PRICE_ID ?? '⚠️  NOT SET',
  org_enterprise_monthly: env.ORG_ENTERPRISE_MONTHLY_PRICE_ID ?? '⚠️  NOT SET',
  org_enterprise_yearly: env.ORG_ENTERPRISE_YEARLY_PRICE_ID ?? '⚠️  NOT SET',
}, 'org_billing_price_ids');

// Ensure a Stripe customer exists for an org, return customerId
async function getOrCreateOrgCustomer(orgId: string, orgName: string, contactEmail: string): Promise<string> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('stripe_customer_id')
    .eq('id', orgId)
    .maybeSingle();

  if ((org as any)?.stripe_customer_id) return (org as any).stripe_customer_id as string;

  const customer = await (stripe.customers as any).create({
    name: orgName,
    email: contactEmail,
    metadata: { orgId, type: 'organization' },
  });

  await supabaseAdmin
    .from('organizations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', orgId);

  return customer.id as string;
}

// Verify the caller is an org admin; returns the admin row or sends 403
async function assertOrgAdmin(req: Request, res: Response, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (!data) {
    res.status(403).json({ error: 'Not authorized' });
    return false;
  }
  return true;
}

// ─── GET /org/:orgId/billing ──────────────────────────────────────────────────
router.get('/:orgId/billing', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.params;
    if (!(await assertOrgAdmin(req, res, orgId as string))) return;

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('org_plan, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_period_end')
      .eq('id', orgId as string)
      .maybeSingle();

    if (!org) return res.status(404).json({ error: 'Org not found' }) as unknown as void;

    const o = org as any;

    let stripeStatus: string | null = null;
    let periodEnd: string | null = null;
    let cancelAtPeriodEnd = false;

    if (o.stripe_subscription_id && STRIPE_MODE === 'real') {
      try {
        const sub: any = await (stripe.subscriptions as any).retrieve(o.stripe_subscription_id);
        stripeStatus = sub.status;
        periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        cancelAtPeriodEnd = sub.cancel_at_period_end ?? false;
      } catch (err) {
        logger.warn({ err, orgId }, 'org_sub_retrieve_failed');
      }
    }

    return res.json(success({
      plan: o.org_plan ?? 'basic',
      status: stripeStatus ?? o.subscription_status ?? 'inactive',
      currentPeriodEnd: periodEnd ?? o.subscription_period_end ?? null,
      cancelAtPeriodEnd,
    }));
  } catch (err) {
    next(err);
  }
});

// ─── POST /org/:orgId/billing/checkout ───────────────────────────────────────
router.post('/:orgId/billing/checkout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.params;
    if (!(await assertOrgAdmin(req, res, orgId as string))) return;

    const schema = z.object({
      plan: z.enum(['pro', 'enterprise']),
      interval: z.enum(['monthly', 'yearly']),
    });
    const body = schema.parse(req.body);

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, contact_email, stripe_subscription_id')
      .eq('id', orgId as string)
      .maybeSingle();

    if (!org) return res.status(404).json({ error: 'Org not found' }) as unknown as void;

    const o = org as any;
    if (o.stripe_subscription_id) {
      return res.status(409).json({
        error: 'Already subscribed. Use the billing portal to manage.',
        code: 'ALREADY_SUBSCRIBED',
      }) as unknown as void;
    }

    const priceKey = `${body.plan}_${body.interval}` as keyof typeof ORG_PRICES;
    const priceId = ORG_PRICES[priceKey]();

    if (!priceId && STRIPE_MODE === 'real') {
      return res.status(400).json({ error: `Price ID for ${priceKey} not configured` }) as unknown as void;
    }

    const contactEmail = o.contact_email ?? req.user!.email ?? 'unknown@meritco.app';
    const customerId = await getOrCreateOrgCustomer(orgId as string, o.name, contactEmail);

    const frontendUrl = env.FRONTEND_URL ?? 'https://meritco.app';
    const session: any = await (stripe.checkout.sessions as any).create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId ?? 'price_placeholder', quantity: 1 }],
      success_url: `${frontendUrl}/org/${orgId}/settings?tab=billing&success=1`,
      cancel_url: `${frontendUrl}/org/${orgId}/settings?tab=billing`,
      metadata: { orgId, plan: body.plan, interval: body.interval, type: 'org_subscription' },
      subscription_data: {
        metadata: { orgId, plan: body.plan, type: 'org_subscription' },
      },
    });

    logger.info({ orgId, plan: body.plan, interval: body.interval }, 'org_checkout_created');
    return res.json(success({ url: session.url }));
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Invalid input' });
    }
    next(err);
  }
});

// ─── POST /org/:orgId/billing/portal ─────────────────────────────────────────
router.post('/:orgId/billing/portal', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.params;
    if (!(await assertOrgAdmin(req, res, orgId as string))) return;

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', orgId as string)
      .maybeSingle();

    const customerId = (org as any)?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({
        error: 'No billing account found. Subscribe first.',
        code: 'NO_CUSTOMER',
      }) as unknown as void;
    }

    const frontendUrl = env.FRONTEND_URL ?? 'https://meritco.app';
    const portal: any = await (stripe.billingPortal.sessions as any).create({
      customer: customerId,
      return_url: `${frontendUrl}/org/${orgId}/settings?tab=billing`,
    });

    return res.json(success({ url: portal.url }));
  } catch (err) {
    next(err);
  }
});

export default router;
