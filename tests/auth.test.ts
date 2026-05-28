/**
 * tests/auth.test.ts
 * Critical auth paths per §22: age restriction, parental consent, password strength.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/services/resend.service', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendParentalConsentEmail: vi.fn().mockResolvedValue(undefined),
  sendAccountDeletionEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/analytics.service', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

// Supabase mock — no existing user by default
let mockExistingUser: any = null;

vi.mock('../src/config/supabase', () => {
  const makeChain = () => {
    const chain: any = {};
    ['select', 'eq', 'neq', 'is', 'order', 'limit', 'not'].forEach((m) => {
      chain[m] = vi.fn(() => chain);
    });
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: mockExistingUser, error: null }),
    );
    chain.single = vi.fn(() =>
      Promise.resolve({ data: mockExistingUser, error: null }),
    );
    chain.insert = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({ data: { id: 'user-new' }, error: null }),
      }),
    }));
    chain.update = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }));
    chain.then = (resolve: any) =>
      Promise.resolve({ data: mockExistingUser, error: null }).then(resolve);
    return chain;
  };
  return {
    supabaseAdmin: {
      from: () => makeChain(),
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1' } },
          error: null,
        }),
        admin: {
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-1' } },
            error: null,
          }),
          deleteUser: vi.fn().mockResolvedValue({ error: null }),
        },
      },
    },
    supabaseAuth: {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1' } },
          error: null,
        }),
        signInWithPassword: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
    SUPABASE_MODE: 'mock',
  };
});

vi.mock('../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:3000',
  },
}));

import { signup } from '../src/services/auth.service';

// ─── Base valid adult input ───────────────────────────────────────────────────

const adultInput = {
  email: 'adult@example.com',
  password: 'Tr0ub4dor&3',   // strong password per zxcvbn
  name: 'Ada Lovelace',
  dateOfBirth: '1990-01-01', // well over 18
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('auth.service — signup: age restrictions (§8, §26 COPPA)', () => {
  beforeEach(() => {
    mockExistingUser = null;
  });

  it('blocks signup for users under 13', async () => {
    // Born ~11 years ago
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 11);

    await expect(
      signup({ ...adultInput, dateOfBirth: dob.toISOString().split('T')[0] }),
    ).rejects.toMatchObject({ code: 'age_restricted', statusCode: 403 });
  });

  it('returns requiresOnboardingConsent for users aged 13–17 (no parentEmail needed at signup)', async () => {
    // Phase 2: minors no longer rejected at signup — they go through onboarding consent page
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 16);

    const result = await signup({ ...adultInput, dateOfBirth: dob.toISOString().split('T')[0] });
    expect(result.requiresOnboardingConsent).toBe(true);
    expect(result.requiresParentalConsent).toBe(false);
  });

  it('accepts a minor when parentEmail is provided', async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 16);

    // Should not throw
    await expect(
      signup({
        ...adultInput,
        dateOfBirth: dob.toISOString().split('T')[0],
        parentEmail: 'parent@example.com',
      }),
    ).resolves.toBeDefined();
  });

  it('accepts an adult without parentEmail', async () => {
    await expect(signup(adultInput)).resolves.toBeDefined();
  });
});

describe('auth.service — signup: password strength (§8)', () => {
  beforeEach(() => {
    mockExistingUser = null;
  });

  it('rejects the word "password"', async () => {
    await expect(
      signup({ ...adultInput, password: 'password' }),
    ).rejects.toMatchObject({ code: 'weak_password', statusCode: 400 });
  });

  it('rejects short/simple passwords', async () => {
    await expect(
      signup({ ...adultInput, password: '123456' }),
    ).rejects.toMatchObject({ code: 'weak_password', statusCode: 400 });
  });

  it('rejects a password equal to the email', async () => {
    await expect(
      signup({ ...adultInput, password: adultInput.email }),
    ).rejects.toMatchObject({ code: 'weak_password' });
  });

  it('accepts a strong password', async () => {
    await expect(signup(adultInput)).resolves.toBeDefined();
  });
});

describe('auth.service — signup: duplicate email (§8)', () => {
  it('rejects if email is already taken', async () => {
    mockExistingUser = { id: 'existing-user' };

    await expect(signup(adultInput)).rejects.toMatchObject({
      code: 'email_taken',
      statusCode: 409,
    });
  });
});
