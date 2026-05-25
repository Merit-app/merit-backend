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

  // Try to pull richer subscription data from subscriptions table (may not exist yet)
  let stripeSubscriptionId: string | null = null;
  let status: string = u.plan === 'free' ? 'free' : 'active';
  let periodEnd: string | null = null;

  try {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status, current_period_end')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub) {
      const s = sub as any;
      stripeSubscriptionId = s.stripe_subscription_id ?? null;
      status = s.status ?? status;
      periodEnd = s.current_period_end ?? null;
    }
  } catch {
    // subscriptions table may not exist — degrade gracefully
  }

  return {
    plan: u.plan as Plan,
    stripeCustomerId: u.stripe_customer_id ?? null,
    stripeSubscriptionId,
    status,
    periodEnd,
  };
}

// ─── Cancel subscription ──────────────────────────────────────────────────

export async function cancelSubscription(userId: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .maybeSingle();

  const u = user as any;
  if (!u?.stripe_subscription_id) {
    throw new AppError('no_subscription', 'No active subscription found.', 404);
  }

  // Cancel at period end rather than immediately
  await stripe.subscriptions.cancel(u.stripe_subscription_id);

  await supabaseAdmin
    .from('users')
    .update({ subscription_status: 'canceling' })
    .eq('id', userId);

  logger.info({ userId, subscriptionId: u.stripe_subscription_id }, 'subscription_canceled');
  return { canceled: true };
}

// ─── Sync subscription from Stripe event ─────────────────────────────────

export async function syncSubscription(
  stripeSubscriptionId: string,
  stripeCustomerId: string,
  status: string,
  priceId: string | null,
  periodEnd: number | null,
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
  const plan: Plan = (priceId && planFromPriceId(priceId)) || 'free';
  const activePlan: Plan = status === 'active' || status === 'trialing' ? plan : 'free';

  await supabaseAdmin
    .from('users')
    .update({
      plan: activePlan,
      stripe_subscription_id: stripeSubscriptionId,
      subscription_status: status,
      subscription_period_end: periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : null,
    })
    .eq('id', u.id);

  logger.info({ userId: u.id, plan: activePlan, status }, 'subscription_synced');
}
