import { env } from './env';

const mockStripe = {
  customers: {
    create: async (params: any) => {
      console.log('[MOCK_STRIPE] customers.create', params);
      return { id: 'cus_mock_' + Date.now() };
    },
    retrieve: async (id: string) => ({ id, email: null }),
  },
  checkout: {
    sessions: {
      create: async (params: any) => {
        console.log('[MOCK_STRIPE] checkout.sessions.create', params);
        return { id: 'cs_mock_' + Date.now(), url: 'mock://checkout' };
      },
    },
  },
  billingPortal: {
    sessions: {
      create: async (params: any) => {
        console.log('[MOCK_STRIPE] billingPortal.sessions.create', params);
        return { url: 'mock://billing-portal' };
      },
    },
  },
  webhooks: {
    constructEvent: (payload: string | Buffer, sig: string, secret: string) => {
      console.log('[MOCK_STRIPE] webhooks.constructEvent (mock passthrough)');
      return JSON.parse(payload.toString()) as any;
    },
  },
  subscriptions: {
    retrieve: async (id: string) => ({ id, status: 'active', items: { data: [] } }),
    cancel: async (id: string) => ({ id, status: 'canceled' }),
  },
};

const isReal = !!env.STRIPE_SECRET_KEY;

export const STRIPE_MODE: 'real' | 'mock' = isReal ? 'real' : 'mock';

let stripeInstance: typeof mockStripe | any;

if (isReal) {
  const Stripe = require('stripe');
  stripeInstance = new Stripe(env.STRIPE_SECRET_KEY!, { apiVersion: '2025-01-27.acacia' });
} else {
  stripeInstance = mockStripe;
}

export const stripe = stripeInstance;
