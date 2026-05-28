import { stripe, STRIPE_MODE } from '../config/stripe';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { AppError, NotFoundError } from '../lib/errors';
import type { Plan } from '../config/plans';

const PRICE_MAP: Record<string, { plan: Plan; interval: string }> = {};

function buildPriceMap() {
  const pairs: Array<[string | undefined, Plan, string]> = [
    [env.STRIPE_PRICE_PRO_MONTHLY, 'pro', 'month'],
    [env.STRIPE_PRICE_PRO_YEARLY, 'pro', 'year'],
    [env.STRIPE_PRICE_PREMIUM_MONTHLY, 'premium', 'month'],
    [env.STRIPE_PRICE_PREMIUM_YEARLY, 'premium', 'year'],
    [env.STRIPE_PRICE_INSTITUTIONAL, 'institutional', 'month'],
  ];
  for (const [priceId, plan, interval] of pairs) {
    if (priceId) PRICE_MAP[priceId] = { plan, interval };
  }
}
buildPriceMap();

export function planFromPriceId(priceId: string): Plan | null {
  return PRICE_MAP[priceId]?.plan ?? null;
}

// ─── Ensure Stripe customer exists for user ──────────────────────────────

async function getOrCreateCustomer(userId: string): Promise<string> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email, stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (!user) throw new NotFoundError('User');

  const u = user as any;
  if (u.stripe_customer_id) return u.stripe_customer_id;

  const customer = await stripe.customers.create({ email: u.email, metadata: { userId } });

  await supabaseAdmin
    .from('users')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);

  return customer.id;
}

// ─── Create Stripe checkout session ──────────────────────────────────────

export async function createCheckoutSession(
  userId: string,
  priceId: string,
  successUrl?: string,
  cancelUrl?: string,
) {
  if (!PRICE_MAP[priceId] && STRIPE_MODE === 'real') {
    throw new AppError('invalid_price', 'Invalid price ID.', 400);
  }

  const customerId = await getOrCreateCustomer(userId);
  const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl ?? `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl ?? `${frontendUrl}/billing/cancel`,
    automatic_tax: env.STRIPE_TAX_ENABLED ? { enabled: true } : undefined,
    metadata: { userId, priceId },
    subscription_data: { metadata: { userId, priceId } },
  });

  logger.info({ userId, priceId, sessionId: session.id }, 'checkout_session_created');
  return { url: session.url ?? (session as any).url, sessionId: session.id };
}

// ─── Create billing portal session ───────────────────────────────────────

export async function createPortalSession(userId: string, returnUrl?: string) {
  const customerId = await getOrCreateCustomer(userId);
  const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000';

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl ?? `${frontendUrl}/billing`,
  });

  return { url: session.url };
}

// ─── Get current subscription ─────────────────────────────────────────────

export async function getSubscription(userId: string) {
  // Select only columns guaranteed to exist in users table (plan + stripe_customer_id)
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, plan, stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (!user) throw new NotFoundError('User');

  const u = user as any;

  // Pull richer subscription data from users row (post-migration-011) and
  // subscriptions table as fallback / source of additional fields.
  let stripeSubscriptionId: string | null = (u as any).stripe_subscription_id ?? null;
  let status: string = (u as any).subscription_status ?? (u.plan === 'free' ? 'free' : 'active');
  let currentPeriodEnd: string | null = (u as any).subscription_period_end ?? null;
  let cancelAtPeriodEnd = false;
  let paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null = null;

  try {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status, current_period_end, cancel_at_period_end')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub) {
      const s = sub as any;
      stripeSubscriptionId = stripeSubscriptionId ?? s.stripe_subscription_id ?? null;
      status = s.status ?? status;
      currentPeriodEnd = currentPeriodEnd ?? s.current_period_end ?? null;
      cancelAtPeriodEnd = s.cancel_at_period_end ?? false;
    }
  } catch {
    // subscriptions table may not exist — degrade gracefully
  }

  return {
    plan: u.plan as Plan,
    stripeCustomerId: u.stripe_customer_id ?? null,
    stripeSubscriptionId,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    paymentMethod,
  };
}

// ─── Cancel subscription ──────────────────────────────────────────────────

export async function cancelSubscription(userId: string) {
  // Prefer users.stripe_subscription_id (populated after migration 011),
  // fall back to the subscriptions table for existing records.
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .maybeSingle();

  let subscriptionId: string | null = (user as any)?.stripe_subscription_id ?? null;

  if (!subscriptionId) {
    // Fallback: look up the most recent active subscription row
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    subscriptionId = (sub as any)?.stripe_subscription_id ?? null;
  }

  if (!subscriptionId) {
    throw new AppError('no_subscription', 'No active subscription found.', 404);
  }

  // Cancel at period end so user retains access until billing period expires
  await (stripe.subscriptions as any).update(subscriptionId, { cancel_at_period_end: true });

  await supabaseAdmin
    .from('users')
    .update({ subscription_status: 'canceling' })
    .eq('id', userId);

  logger.info({ userId, subscriptionId }, 'subscription_cancel_scheduled');
  return { canceled: true };
}

// ─── Sync subscription from Stripe event ─────────────────────────────────

export async function syncSubscription(
  stripeSubscriptionId: string,
  stripeCustomerId: string,
  status: string,
  priceId: string | null,
  periodEnd: number | null,
  cancelAtPeriodEnd: boolean = false,
) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();

  if (!user) {
    logger.warn({ stripeCustomerId }, 'subscription_sync_no_user');
    return;
  }

  const u = user as any;
  // The tier mapped from the price (null for deletions)
  const mappedPlan: Plan | null = priceId ? planFromPriceId(priceId) : null;
  // Active plan: keep tier if active/trialing, otherwise drop to free
  const activePlan: Plan = (status === 'active' || status === 'trialing') && mappedPlan
    ? mappedPlan
    : 'free';

  const periodEndIso = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  // 1 — Update users table (requires migration 011 for the new columns)
  await supabaseAdmin
    .from('users')
    .update({
      plan: activePlan,
      stripe_subscription_id: stripeSubscriptionId,
      subscription_status: status,
      subscription_period_end: periodEndIso,
    })
    .eq('id', u.id);

  // 2 — Upsert the subscriptions table for richer billing history
  try {
    if (mappedPlan) {
      // Active/trialing subscription — full upsert
      await supabaseAdmin
        .from('subscriptions')
        .upsert(
          {
            user_id: u.id,
            stripe_subscription_id: stripeSubscriptionId,
            stripe_customer_id: stripeCustomerId,
            stripe_price_id: priceId!,
            plan: mappedPlan,
            status,
            current_period_end: periodEndIso,
            cancel_at_period_end: cancelAtPeriodEnd,
            canceled_at: status === 'canceled' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'stripe_subscription_id' },
        );
    } else if (status === 'canceled') {
      // Deletion event — update status on the existing row (no valid plan to upsert)
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'canceled', canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', stripeSubscriptionId);
    } else if (status === 'past_due') {
      // Payment failed — mark past_due without clearing the plan tier
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', stripeSubscriptionId);
    }
  } catch (err) {
    // subscriptions table write failure is non-fatal — user plan is already updated
    logger.warn({ err, stripeSubscriptionId }, 'subscriptions_table_sync_failed');
  }

  logger.info({ userId: u.id, plan: activePlan, status, cancelAtPeriodEnd }, 'subscription_synced');
}
