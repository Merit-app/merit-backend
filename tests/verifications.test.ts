/**
 * tests/verifications.test.ts
 * Critical verification paths per §22: SMS send, opt-out, YES/NO/STOP responses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/services/analytics.service', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/resend.service', () => ({
  sendVerificationRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationConfirmedEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationDisputedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/twilio.service', () => ({
  sendSms: vi.fn().mockResolvedValue({ sid: 'SM_mock_123' }),
}));

vi.mock('../src/services/trust.service', () => ({
  incrementAuthenticatorStats: vi.fn().mockResolvedValue(undefined),
  determineVerificationTier: vi.fn().mockReturnValue('verified_basic'),
  recalculateDomainTrust: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/crypto', () => ({
  generateUrlSafeToken: vi.fn().mockReturnValue('mock-token-abc123'),
}));

vi.mock('../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:3000',
    API_BASE_URL: 'http://localhost:3001',
  },
}));

// ─── Configurable DB state ────────────────────────────────────────────────────
let mockVerification: any = null;
let mockOptOut: any = null;
let mockRateLimit: any = null;

vi.mock('../src/config/supabase', () => {
  const makeChain = (resolveWith: () => any) => {
    const chain: any = {};
    [
      'select', 'eq', 'neq', 'is', 'gte', 'lte', 'lt', 'gt',
      'in', 'or', 'order', 'limit', 'range', 'not',
    ].forEach((m) => { chain[m] = vi.fn(() => chain); });
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: resolveWith(), error: null }),
    );
    chain.single = vi.fn(() =>
      Promise.resolve({ data: resolveWith(), error: null }),
    );
    chain.insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'verif-1' }, error: null }),
      }),
    }));
    chain.update = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
    }));
    chain.upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    chain.then = (resolve: any) =>
      Promise.resolve({ data: resolveWith(), error: null, count: 0 }).then(resolve);
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'sms_opt_outs') return makeChain(() => mockOptOut);
        if (table === 'verifications') return makeChain(() => mockVerification);
        if (table === 'rate_limits') return makeChain(() => mockRateLimit);
        return makeChain(() => null);
      },
    },
    SUPABASE_MODE: 'mock', // disables rate-limit DB check in service
  };
});

import { sendVerificationSMS, processVerificationResponse } from '../src/services/verifications.service';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockSession = {
  id: 'session-1',
  user_id: 'user-1',
  hours: 4,
  date: '2026-05-01',
  status: 'pending',
  supervisor_name: 'Jane Smith',
  supervisor_phone: '+16045551234',
  supervisor_email: 'jane@org.com',
  org: { name: 'Red Cross' },
  authenticator: { id: 'auth-1', tier: 'personal_email', email_domain: null },
};

const mockUser = { id: 'user-1', name: 'Test Student', plan: 'free' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('verifications.service — sendVerificationSMS', () => {
  beforeEach(() => {
    mockOptOut = null;
    mockRateLimit = null;
    mockVerification = null;
  });

  it('sends SMS and returns a sid', async () => {
    const { sendSms } = await import('../src/services/twilio.service');
    await sendVerificationSMS(mockSession, mockUser);
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+16045551234' }),
    );
  });

  it('throws supervisor_opted_out when phone is on opt-out list', async () => {
    mockOptOut = { phone: '+16045551234' };
    await expect(sendVerificationSMS(mockSession, mockUser)).rejects.toMatchObject({
      code: 'supervisor_opted_out',
      statusCode: 409,
    });
  });

  it('throws no_phone when session has no supervisor phone', async () => {
    const sessionNoPhone = { ...mockSession, supervisor_phone: undefined };
    await expect(sendVerificationSMS(sessionNoPhone, mockUser)).rejects.toMatchObject({
      code: 'no_phone',
      statusCode: 400,
    });
  });
});

describe('verifications.service — processVerificationResponse (phone/SMS path)', () => {
  beforeEach(() => {
    mockVerification = null;
  });

  it('returns null when no pending verification exists for phone', async () => {
    mockVerification = null;
    const result = await processVerificationResponse({
      phone: '+16045551234',
      response: 'YES',
    });
    expect(result).toBeNull();
  });

  it('handles STOP → returns opt_out', async () => {
    mockVerification = {
      id: 'verif-1',
      destination: '+16045551234',
      channel: 'sms',
      responded_at: null,
      response: null,
      session: mockSession,
    };
    const result = await processVerificationResponse({
      phone: '+16045551234',
      response: 'STOP',
    });
    expect(result).toMatchObject({ handled: 'opt_out' });
  });

  it('handles YES → returns verified', async () => {
    mockVerification = {
      id: 'verif-1',
      destination: '+16045551234',
      channel: 'sms',
      responded_at: null,
      response: null,
      session: { ...mockSession, status: 'pending' },
    };
    const result = await processVerificationResponse({
      phone: '+16045551234',
      response: 'YES',
    });
    expect(result).toMatchObject({ handled: 'verified' });
  });

  it('handles NO → returns disputed', async () => {
    mockVerification = {
      id: 'verif-1',
      destination: '+16045551234',
      channel: 'sms',
      responded_at: null,
      response: null,
      session: { ...mockSession, status: 'pending' },
    };
    const result = await processVerificationResponse({
      phone: '+16045551234',
      response: 'NO',
    });
    expect(result).toMatchObject({ handled: 'disputed' });
  });
});

describe('verifications.service — processVerificationResponse (magic link path)', () => {
  it('throws invalid_token when token not found', async () => {
    mockVerification = null;
    await expect(
      processVerificationResponse({ token: 'bad-token', response: 'YES' }),
    ).rejects.toMatchObject({ code: 'invalid_token', statusCode: 400 });
  });

  it('throws already_responded when verification already answered', async () => {
    mockVerification = {
      id: 'verif-1',
      confirmation_token: 'valid-token',
      responded_at: new Date().toISOString(), // already answered
      token_expires_at: null,
      session: mockSession,
    };
    await expect(
      processVerificationResponse({ token: 'valid-token', response: 'YES' }),
    ).rejects.toMatchObject({ code: 'already_responded', statusCode: 409 });
  });
});
