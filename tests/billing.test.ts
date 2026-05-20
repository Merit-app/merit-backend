import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let mockUser: any = { id: 'user-1', email: 'test@example.com', plan: 'free', stripe_customer_id: null };

vi.mock('../src/config/supabase', () => {
  const makeChain = () => {
    const c: any = {};
    ['select','eq','neq','is','gte','lte','in','order','limit'].forEach(m => { c[m] = () => c; });
    c.maybeSingle = () => Promise.resolve({ data: mockUser, error: null });
    c.single = () => Promise.resolve({ data: mockUser, error: null });
    c.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
    c.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) });
    c.then = (resolve: any) => Promise.resolve({ data: mockUser, error: null }).then(resolve);
    return c;
  };
  return { supabaseAdmin: { from: () => makeChain() }, SUPABASE_MODE: 'mock' };
});

vi.mock('../src/config/stripe', () => ({
  STRIPE_MODE: 'mock',
  stripe: {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_mock_123' }),
      retrieve: vi.fn().mockResolvedValue({ id: 'cus_mock_123', email: 'test@example.com' }),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: 'cs_mock_123', url: 'https://checkout.stripe.com/mock' }),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/mock' }),
      },
    },
    subscriptions: {
      cancel: vi.fn().mockResolvedValue({ id: 'sub_mock', status: 'canceled' }),
    },
  },
}));

vi.mock('../src/config/env', () => ({
  env: {
    FRONTEND_URL: 'http://localhost:3000',
    STRIPE_TAX_ENABLED: false,
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
    STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
    STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_monthly',
    STRIPE_PRICE_PREMIUM_YEARLY: 'price_premium_yearly',
    STRIPE_PRICE_INSTITUTIONAL: 'price_institutional',
  },
}));

import { planFromPriceId, createCheckoutSession, createPortalSession, getSubscription } from '../src/services/billing.service';

describe('billing.service — planFromPriceId', () => {
  it('maps known price IDs to plans', () => {
    expect(planFromPriceId('price_pro_monthly')).toBe('pro');
    expect(planFromPriceId('price_pro_yearly')).toBe('pro');
    expect(planFromPriceId('price_premium_monthly')).toBe('premium');
    expect(planFromPriceId('price_premium_yearly')).toBe('premium');
    expect(planFromPriceId('price_institutional')).toBe('institutional');
  });

  it('returns null for unknown price IDs', () => {
    expect(planFromPriceId('price_unknown')).toBeNull();
  });
});

describe('billing.service — createCheckoutSession', () => {
  beforeEach(() => {
    mockUser = { id: 'user-1', email: 'test@example.com', plan: 'free', stripe_customer_id: 'cus_existing' };
  });

  it('returns a checkout URL and session ID', async () => {
    const result = await createCheckoutSession('user-1', 'price_pro_monthly');
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('sessionId');
    expect(result.sessionId).toBe('cs_mock_123');
  });
});

describe('billing.service — createPortalSession', () => {
  it('returns a portal URL', async () => {
    const result = await createPortalSession('user-1');
    expect(result).toHaveProperty('url');
    expect(result.url).toContain('stripe');
  });
});

describe('billing.service — getSubscription', () => {
  it('returns subscription info for a user', async () => {
    mockUser = { id: 'user-1', plan: 'pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'active', subscription_period_end: null };
    const result = await getSubscription('user-1');
    expect(result.plan).toBe('pro');
    expect(result.status).toBe('active');
  });
});
