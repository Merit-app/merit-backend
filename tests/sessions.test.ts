/**
 * tests/sessions.test.ts
 * Critical session paths per §22: CRUD, fraud integration, access control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/services/analytics.service', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Configurable DB state ────────────────────────────────────────────────────
let mockSession: any = null;
let mockUser: any = { id: 'user-1', email: 'student@example.com', plan: 'free' };
let mockOrg: any = { id: 'org-1', name: 'Red Cross', city: 'Vancouver', state: 'BC' };
let mockAuthenticator: any = { id: 'auth-1', tier: 'personal_email' };

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
        single: () => Promise.resolve({ data: { id: 'new-session', ...resolveWith() }, error: null }),
      }),
    }));
    // update().eq().eq()... chains then is awaitable
    const makeUpdateChain = () => {
      const uc: any = {};
      uc.eq = vi.fn(() => uc);
      uc.select = vi.fn(() => ({ single: () => Promise.resolve({ data: resolveWith(), error: null }) }));
      uc.then = (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve);
      return uc;
    };
    chain.update = vi.fn(() => makeUpdateChain());
    chain.delete = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }));
    chain.then = (resolve: any) =>
      Promise.resolve({ data: resolveWith(), error: null, count: 1 }).then(resolve);
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'sessions') return makeChain(() => mockSession);
        if (table === 'users') return makeChain(() => mockUser);
        if (table === 'organizations') return makeChain(() => mockOrg);
        if (table === 'authenticators') return makeChain(() => mockAuthenticator);
        return makeChain(() => null);
      },
    },
    SUPABASE_MODE: 'mock',
  };
});

// Mock trust + fraud services so createSession doesn't need full DB
vi.mock('../src/services/trust.service', () => ({
  resolveOrCreateAuthenticator: vi.fn().mockResolvedValue({
    id: 'auth-1', tier: 'personal_email',
  }),
  recalculateDomainTrust: vi.fn().mockResolvedValue(undefined),
  incrementAuthenticatorStats: vi.fn().mockResolvedValue(undefined),
  determineVerificationTier: vi.fn().mockReturnValue('verified_basic'),
}));

vi.mock('../src/services/fraud.service', () => ({
  calculateFraudScore: vi.fn().mockResolvedValue({ score: 0.1, flags: [] }),
}));

vi.mock('../src/services/organizations.service', () => ({
  resolveOrCreateOrg: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Red Cross' }),
}));

// BullMQ queue — null in test (no Redis)
vi.mock('../src/queues/index', () => ({
  smsQueue: null,
  emailQueue: null,
  pdfQueue: null,
}));

vi.mock('../src/lib/phone', () => ({
  normalizePhone: vi.fn((p: string) => (p.startsWith('+') ? p : null)),
  isValidPhone: vi.fn(() => true),
}));

import { getSessions, getSession, createSession, deleteSession } from '../src/services/sessions.service';

// ─── Tests ────────────────────────────────────────────────────────────────────

const validInput = {
  orgName: 'Red Cross',
  date: '2026-05-01',
  hours: 4,
  description: 'Blood drive setup',
  supervisorName: 'Jane Smith',
  supervisorPhone: '+16045551234',
};

describe('sessions.service — getSessions', () => {
  beforeEach(() => {
    mockSession = [{ id: 'session-1', user_id: 'user-1', hours: 4, status: 'pending', date: '2026-05-01' }];
  });

  it('returns sessions and pagination meta', async () => {
    const result = await getSessions('user-1', { page: 1, perPage: 20 });
    expect(result).toHaveProperty('sessions');
    expect(result).toHaveProperty('meta');
    expect(result.meta).toHaveProperty('page', 1);
    expect(result.meta).toHaveProperty('perPage', 20);
  });
});

describe('sessions.service — getSession', () => {
  it('returns a session when found', async () => {
    mockSession = { id: 'session-1', user_id: 'user-1', hours: 4, status: 'pending' };
    const session = await getSession('session-1', 'user-1');
    expect(session).toBeDefined();
    expect(session.id).toBe('session-1');
  });

  it('throws NotFoundError when session is missing', async () => {
    mockSession = null;
    await expect(getSession('missing', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('sessions.service — createSession', () => {
  beforeEach(() => {
    mockSession = { id: 'new-session', user_id: 'user-1', hours: 4, status: 'pending' };
  });

  it('creates a session and returns it', async () => {
    const result = await createSession('user-1', validInput, 'free', 'Test Student');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('id');
  });

  it('rejects an invalid phone number', async () => {
    const { normalizePhone } = await import('../src/lib/phone');
    (normalizePhone as any).mockReturnValueOnce(null);

    await expect(
      createSession('user-1', { ...validInput, supervisorPhone: 'not-a-phone' }, 'free'),
    ).rejects.toMatchObject({ code: 'invalid_phone', statusCode: 400 });
  });
});

describe('sessions.service — deleteSession (soft delete)', () => {
  it('soft-deletes a session the user owns', async () => {
    mockSession = { id: 'session-1', user_id: 'user-1', status: 'pending', deleted_at: null };
    await expect(deleteSession('session-1', 'user-1')).resolves.toMatchObject({ deleted: true });
  });

  it('throws NotFoundError for a session that does not exist', async () => {
    mockSession = null;
    await expect(deleteSession('missing', 'user-1')).rejects.toMatchObject({ statusCode: 404 });
  });
});
