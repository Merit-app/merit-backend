import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock supabase with configurable responses
let mockSessionsData: any[] = [];
let mockVerificationsData: any[] = [];

vi.mock('../src/config/supabase', () => {
  const makeChain = (resolveWith: () => any) => {
    const chain: any = {};
    const noop = () => chain;
    ['select','eq','neq','is','gte','lte','lt','gt','in','or','order','limit','range']
      .forEach(m => { chain[m] = noop; });
    chain.maybeSingle = () => Promise.resolve({ data: resolveWith(), error: null });
    chain.single = () => Promise.resolve({ data: resolveWith(), error: null });
    // Make chain itself awaitable
    chain.then = (resolve: any) => Promise.resolve({ data: resolveWith(), error: null, count: 0 }).then(resolve);
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'sessions') return makeChain(() => mockSessionsData);
        if (table === 'verifications') return makeChain(() => mockVerificationsData);
        return makeChain(() => null);
      },
    },
    SUPABASE_MODE: 'mock',
  };
});

import { calculateFraudScore } from '../src/services/fraud.service';

const baseInput = {
  user_id: 'user-1',
  org_id: 'org-1',
  date: new Date().toISOString().split('T')[0], // today
  hours: 4,
  supervisor_phone: undefined,
  supervisor_email: 'super@example.com',
};

describe('fraud.service — calculateFraudScore', () => {
  beforeEach(() => {
    mockSessionsData = [];
    mockVerificationsData = [];
  });

  it('returns low score for a clean first session', async () => {
    const { score, flags } = await calculateFraudScore(baseInput);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.6);
    expect(flags).toBeInstanceOf(Array);
  });

  it('flags future_date when session date is tomorrow', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const { flags } = await calculateFraudScore({ ...baseInput, date: tomorrow });
    expect(flags).toContain('future_date');
  });

  it('does not flag round_numbers for a single session', async () => {
    // With no history the always_round_numbers check cannot trigger
    mockSessionsData = [];
    const { flags } = await calculateFraudScore({ ...baseInput, hours: 4 });
    expect(flags).not.toContain('always_round_numbers');
  });

  it('flags impossible_hours for >16 hours in a day', async () => {
    const { flags } = await calculateFraudScore({ ...baseInput, hours: 17 });
    expect(flags).toContain('impossible_hours');
  });

  it('score is between 0 and 1', async () => {
    const { score } = await calculateFraudScore(baseInput);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
