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
    const { data: existing } = await supabaseAdmin
      .from('stripe_events')
      .select('id')
      .eq('stripe_event_id', event.id)
      .maybeSingle();

    if (existing) {
      logger.info({ eventId: event.id }, 'stripe_event_already_processed');
      res.json({ received: true });
      return;
    }

    // Record event before processing to prevent duplicate side-effects
    await supabaseAdmin
      .from('stripe_events')
      .insert({ stripe_event_id: event.id, type: event.type, processed_at: new Date().toISOString() });

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
      // subscription is created; subscription.updated fires after, so we just log here
      logger.info({ sessionId: obj.id, customerId: obj.customer }, 'checkout_completed');
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const priceId: string | null = obj.items?.data?.[0]?.price?.id ?? null;
      await syncSubscription(
        obj.id,
        obj.customer,
        obj.status,
        priceId,
        obj.current_period_end ?? null,
      );
      break;
    }

    case 'customer.subscription.deleted': {
      await syncSubscription(obj.id, obj.customer, 'canceled', null, null);
      break;
    }

    case 'invoice.payment_succeeded': {
      logger.info({ invoiceId: obj.id, customerId: obj.customer, amount: obj.amount_paid }, 'invoice_paid');
      // Subscription status is kept current by subscription.updated; nothing extra needed
      break;
    }

    case 'invoice.payment_failed': {
      logger.warn({ invoiceId: obj.id, customerId: obj.customer }, 'invoice_payment_failed');

      // Mark subscription as past_due
      if (obj.subscription) {
        await syncSubscription(obj.subscription, obj.customer, 'past_due', null, null);
      }
      break;
    }

    default:
      logger.debug({ type }, 'stripe_event_unhandled');
  }
}

export default router;
