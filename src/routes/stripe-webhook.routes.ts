import { Router, Request, Response, NextFunction } from 'express';
import { stripe, STRIPE_MODE } from '../config/stripe';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { supabaseAdmin } from '../config/supabase';
import { syncSubscription } from '../services/billing.service';

const router = Router();

// POST /webhooks/stripe — raw body required for signature verification
router.post(
  '/webhooks/stripe',
  async (req: Request, res: Response, next: NextFunction) => {
    let event: any;

    try {
      const sig = req.headers['stripe-signature'] as string;
      const secret = env.STRIPE_WEBHOOK_SECRET;

      if (secret && sig) {
        // req.body is a Buffer when express.raw() is used for this route
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
      } else if (STRIPE_MODE === 'mock') {
        event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } else {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'stripe_webhook_signature_failed');
      res.status(400).json({ error: `Webhook error: ${err.message}` });
      return;
    }

    // Idempotency — skip events already processed
    // stripe_events PK is `id` which stores the Stripe event ID directly
    const { data: existing } = await supabaseAdmin
      .from('stripe_events')
      .select('id')
      .eq('id', event.id)
      .maybeSingle();

    if (existing) {
      logger.info({ eventId: event.id }, 'stripe_event_already_processed');
      res.json({ received: true });
      return;
    }

    // Record event before processing to prevent duplicate side-effects
    await supabaseAdmin
      .from('stripe_events')
      .insert({ id: event.id, type: event.type, processed_at: new Date().toISOString(), data: event.data });

    try {
      await handleStripeEvent(event);
    } catch (err) {
      logger.error({ err, eventId: event.id, type: event.type }, 'stripe_event_handler_failed');
      // Still return 200 so Stripe doesn't retry — we've recorded the event
    }

    res.json({ received: true });
  },
);

async function handleStripeEvent(event: any): Promise<void> {
  const { type, data } = event;
  const obj = data.object;

  switch (type) {
    case 'checkout.session.completed': {
      // Check if this is an org subscription checkout
      if (obj.metadata?.type === 'org_subscription') {
        const { orgId, plan } = obj.metadata ?? {};
        const subscriptionId: string | null = obj.subscription ?? null;
        if (orgId && plan && subscriptionId) {
          await supabaseAdmin
            .from('organizations')
            .update({
              org_plan: plan,
              stripe_subscription_id: subscriptionId,
              subscription_status: 'active',
            })
            .eq('id', orgId);
          logger.info({ orgId, plan }, 'org_subscription_activated');
        }
        break;
      }

      // Eagerly sync the subscription so plan upgrades land immediately.
      // customer.subscription.created fires shortly after, but this ensures
      // the plan is set even if that event arrives out of order or is delayed.
      const subscriptionId: string | null = obj.subscription ?? null;
      if (subscriptionId) {
        try {
          // Expand the live subscription from Stripe for accurate status + period
          const sub = await (stripe.subscriptions as any).retrieve(subscriptionId);
          const priceId: string | null = sub?.items?.data?.[0]?.price?.id ?? obj.metadata?.priceId ?? null;
          await syncSubscription(
            subscriptionId,
            obj.customer,
            sub?.status ?? 'active',
            priceId,
            sub?.current_period_end ?? null,
            sub?.cancel_at_period_end ?? false,
          );
        } catch (err) {
          // In mock/test mode the subscription may not be retrievable — safe to skip,
          // customer.subscription.created will handle it.
          logger.warn({ err: (err as any)?.message, sessionId: obj.id }, 'checkout_subscription_expand_failed');
        }
      }
      logger.info({ sessionId: obj.id, customerId: obj.customer }, 'checkout_completed');
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      // Org subscriptions: update organizations table directly
      if (obj.metadata?.type === 'org_subscription') {
        const orgId = obj.metadata?.orgId;
        if (orgId) {
          await supabaseAdmin
            .from('organizations')
            .update({
              subscription_status: obj.status,
              subscription_period_end: obj.current_period_end
                ? new Date(obj.current_period_end * 1000).toISOString()
                : null,
            })
            .eq('stripe_subscription_id', obj.id);
          logger.info({ orgId, status: obj.status }, 'org_subscription_updated');
        }
        break;
      }

      const priceId: string | null = obj.items?.data?.[0]?.price?.id ?? null;
      await syncSubscription(
        obj.id,
        obj.customer,
        obj.status,
        priceId,
        obj.current_period_end ?? null,
        obj.cancel_at_period_end ?? false,
      );
      break;
    }

    case 'customer.subscription.deleted': {
      // Org subscription cancellation
      if (obj.metadata?.type === 'org_subscription') {
        const orgId = obj.metadata?.orgId;
        if (orgId) {
          await supabaseAdmin
            .from('organizations')
            .update({
              org_plan: 'basic',
              subscription_status: 'cancelled',
              stripe_subscription_id: null,
            })
            .eq('id', orgId);
          logger.info({ orgId }, 'org_subscription_cancelled');
        }
        break;
      }

      await syncSubscription(obj.id, obj.customer, 'canceled', null, null, false);
      break;
    }

    case 'invoice.payment_succeeded': {
      logger.info({ invoiceId: obj.id, customerId: obj.customer, amount: obj.amount_paid }, 'invoice_paid');
      // Subscription status is kept current by subscription.updated; nothing extra needed
      break;
    }

    case 'invoice.payment_failed': {
      logger.warn({ invoiceId: obj.id, customerId: obj.customer }, 'invoice_payment_failed');

      // Mark subscription as past_due — preserve the price so the plan isn't cleared
      if (obj.subscription) {
        const lineItem = obj.lines?.data?.[0];
        const priceId: string | null = lineItem?.price?.id ?? null;
        await syncSubscription(obj.subscription, obj.customer, 'past_due', priceId, null, false);
      }
      break;
    }

    default:
      logger.debug({ type }, 'stripe_event_unhandled');
  }
}

export default router;
